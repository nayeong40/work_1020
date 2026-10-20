// 2027년 국방예산 중점 투자사업 (분야별 · 신규사업별) 인터랙티브 대시보드 메인 로직
(function () {
  const PALETTE = [
    "#2563EB", "#0D9488", "#7C3AED", "#0284C7",
    "#EA580C", "#DC2626", "#16A34A", "#4F46E5",
    "#D97706", "#DB2777"
  ];

  const state = {
    data: JSON.parse(JSON.stringify(window.DEFAULT_BUDGET_DATA)),
    workbook: null,
    activeTab: "category", // 'category' | 'new' | 'overview' | 'raw'
    catSumMode: "excludeSub", // 'excludeSub' (중복제외) | 'all' (단순합산)
    catScaleMode: "excludeCat1", // 'excludeCat1' (① 제외 상세스케일) | 'all' (① 포함 전체)
    selectedCatNo: "ALL",
    newFilterMode: "strict", // 'strict' (9건 1,503억 - 구분 '신규') | 'allNew' (10건 1,819억 - 증감률 '신규' 전체)
    newCatFilter: "ALL",
    newSearchQuery: "",
    catSearchQuery: "",
    catTypeFilter: "ALL",
    rawSearchQuery: "",
    sortConfig: { key: "id", dir: "asc" },
    newSortConfig: { key: "budget2027", dir: "desc" }
  };

  // 숫자 포맷팅 (억 원 단위 및 조·억 병기)
  function fmtNum(val, decimals = 1) {
    if (val === null || val === undefined || isNaN(val)) return "-";
    const n = Number(val);
    if (Number.isInteger(n)) return n.toLocaleString("ko-KR");
    return n.toLocaleString("ko-KR", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
  }

  function fmtJoEok(eokVal) {
    const n = Number(eokVal) || 0;
    if (Math.abs(n) >= 10000) {
      const jo = Math.floor(Math.abs(n) / 10000);
      const rem = +(Math.abs(n) % 10000).toFixed(1);
      const sign = n < 0 ? "-" : "";
      return `${sign}${jo}조 ${rem > 0 ? fmtNum(rem) + "억" : ""}원`.trim();
    }
    return `${fmtNum(n)}억 원`;
  }

  function getCatMeta(catNo, index = 0) {
    const details = state.data.categoryDetails?.[catNo];
    if (details) return details;
    const color = PALETTE[index % PALETTE.length];
    return {
      color,
      lightBg: "#F8FAFC",
      border: "#E2E8F0",
      icon: "📌",
      goal: `${catNo} 중점 투자사업 분야`,
      bullets: []
    };
  }

  function getTypeBadgeClass(typeStr) {
    const s = String(typeStr || "");
    if (s.includes("총괄")) return "type-total";
    if (s.includes("신규")) return "type-new";
    if (s.includes("직접")) return "type-direct";
    if (s.includes("연계")) return "type-linked";
    return "type-sub";
  }

  // 분야별 집계 데이터 계산
  function computeCategoryGroups() {
    const map = new Map();
    const items = state.data.items || [];

    // 각 분야에 '중점분야 총괄' 항목이 존재하는지 먼저 확인
    const hasTotalRowByCat = new Set();
    items.forEach((item) => {
      if (String(item.type).includes("총괄")) {
        hasTotalRowByCat.add(item.catNo);
      }
    });

    items.forEach((item) => {
      const key = item.catNo || "기타";
      if (!map.has(key)) {
        map.set(key, {
          catNo: key,
          category: item.category,
          budget2026: 0,
          budget2027: 0,
          diff: 0,
          totalItemsCount: 0,
          newItemsCount: 0,
          strictNewCount: 0,
          newBudget2027: 0,
          strictNewBudget2027: 0,
          subItemsCount: 0,
          items: []
        });
      }
      const g = map.get(key);
      g.items.push(item);
      g.totalItemsCount += 1;
      if (item.isSubItem) g.subItemsCount += 1;

      if (item.isNew) {
        g.newItemsCount += 1;
        g.newBudget2027 += Number(item.budget2027) || 0;
      }
      if (item.isStrictNew) {
        g.strictNewCount += 1;
        g.strictNewBudget2027 += Number(item.budget2027) || 0;
      }

      // 합산 모드에 따라 내역사업(└) 중복 제외 여부 결정
      const shouldExclude =
        state.catSumMode === "excludeSub" &&
        item.isSubItem &&
        hasTotalRowByCat.has(key);

      if (!shouldExclude) {
        g.budget2026 = +(g.budget2026 + (Number(item.budget2026) || 0)).toFixed(2);
        g.budget2027 = +(g.budget2027 + (Number(item.budget2027) || 0)).toFixed(2);
        g.diff = +(g.budget2027 - g.budget2026).toFixed(2);
      }
    });

    const groups = Array.from(map.values());
    groups.forEach((g, idx) => {
      g.meta = getCatMeta(g.catNo, idx);
      if (g.budget2026 === 0 && g.budget2027 > 0) {
        g.rate = null;
        g.rateText = "신규";
      } else if (g.budget2026 > 0) {
        g.rate = (g.budget2027 - g.budget2026) / g.budget2026;
        g.rateText = (g.rate * 100).toFixed(1) + "%";
      } else {
        g.rate = 0;
        g.rateText = "0.0%";
      }
    });
    return groups;
  }

  // 신규사업 필터링된 목록 반환
  function getNewProjectItems() {
    const items = state.data.items || [];
    // 만약 업로드된 파일 자체가 '신규사업_추출' 전용 시트여서 모든 행이 신규사업이면 그대로 반환
    const strictItems = items.filter((it) => it.isStrictNew);
    const allNewItems = items.filter((it) => it.isNew);

    if (state.data.isNewOnlySheet) {
      return allNewItems;
    }
    if (state.newFilterMode === "strict") {
      return strictItems.length > 0 ? strictItems : allNewItems;
    }
    return allNewItems;
  }

  // 토스트 알림 표시
  function showToast(msg, type = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    const icon = type === "success" ? "✅" : type === "error" ? "⚠️" : "ℹ️";
    toast.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.25s ease";
      setTimeout(() => toast.remove(), 260);
    }, 3400);
  }

  // 상단 헤더 & 상태바 업데이트
  function renderHeaderAndStatus() {
    document.getElementById("pageTitle").textContent = state.data.title || "국방예산 중점 투자사업 대시보드";
    document.getElementById("pageSubtitle").textContent = state.data.subtitle || "";
    document.getElementById("loadedFileName").textContent = state.data.fileName || "기본 데이터";

    const groups = computeCategoryGroups();
    const strictNew = (state.data.items || []).filter((i) => i.isStrictNew);
    const allNew = (state.data.items || []).filter((i) => i.isNew);
    const newCount = state.newFilterMode === "strict" && strictNew.length > 0 ? strictNew.length : allNew.length;

    document.getElementById("tabCatCount").textContent = `${groups.length}개 분야`;
    document.getElementById("tabNewCount").textContent = `${newCount}건`;
    document.getElementById("tabRawCount").textContent = `${(state.data.items || []).length}행`;

    // 시트 선택 드롭다운 표시 제어
    const sheetSelect = document.getElementById("sheetSelector");
    if (state.workbook && state.workbook.sheetNames && state.workbook.sheetNames.length > 1) {
      sheetSelect.style.display = "inline-block";
      sheetSelect.innerHTML = state.workbook.sheetNames
        .map((s) => `<option value="${s}" ${s === state.workbook.activeSheet ? "selected" : ""}>시트: ${s}</option>`)
        .join("");
    } else {
      sheetSelect.style.display = "none";
    }
  }

  // =========================================================================
  // TAB 1: 🏛️ 분야별 대시보드 렌더링
  // =========================================================================
  function renderCategoryDashboard() {
    const groups = computeCategoryGroups();
    const total2026 = groups.reduce((acc, g) => acc + g.budget2026, 0);
    const total2027 = groups.reduce((acc, g) => acc + g.budget2027, 0);
    const totalDiff = +(total2027 - total2026).toFixed(2);
    const totalRate = total2026 > 0 ? ((totalDiff / total2026) * 100).toFixed(1) + "%" : "신규";

    // ①번(전작권 전환) 제외한 7대 분야 합산
    const exCat1Groups = groups.filter((g) => g.catNo !== "①");
    const ex2026 = exCat1Groups.reduce((acc, g) => acc + g.budget2026, 0);
    const ex2027 = exCat1Groups.reduce((acc, g) => acc + g.budget2027, 0);
    const exDiff = +(ex2027 - ex2026).toFixed(2);
    const exRate = ex2026 > 0 ? ((exDiff / ex2026) * 100).toFixed(1) + "%" : "신규";

    // 최고 증가율 분야 탐색 (전년 예산이 있는 분야 중)
    let maxGrowthGroup = groups[0] || { category: "-", rateText: "-", catNo: "" };
    groups.forEach((g) => {
      if (g.rate !== null && (maxGrowthGroup.rate === null || g.rate > maxGrowthGroup.rate)) {
        maxGrowthGroup = g;
      }
    });

    // 신규 투자만 구성된 분야 수
    const newActiveCats = groups.filter((g) => g.newItemsCount > 0);

    // 1. 분야별 KPI 카드 렌더링
    const kpiContainer = document.getElementById("catKpiGrid");
    kpiContainer.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-top">
          <span class="kpi-title">중점 투자사업 총 예산 (’27년)</span>
          <span class="kpi-icon">🏛️</span>
        </div>
        <div class="kpi-value">${fmtJoEok(total2027)}</div>
        <div class="kpi-sub">
          <span>’26년 ${fmtNum(total2026)}억 → ’27년 ${fmtNum(total2027)}억</span>
          <span class="delta-badge delta-up">+${fmtNum(totalDiff)}억 (+${totalRate})</span>
        </div>
      </div>

      <div class="kpi-card kpi-teal">
        <div class="kpi-top">
          <span class="kpi-title">${exCat1Groups.length > 0 && groups.length > exCat1Groups.length ? "②~⑧ 7대 분야 예산 합산 (① 제외)" : "분야당 평균 편성 예산"}</span>
          <span class="kpi-icon">📊</span>
        </div>
        ${
          exCat1Groups.length > 0 && groups.length > exCat1Groups.length
            ? `<div class="kpi-value">${fmtNum(ex2027)}억 원</div>
               <div class="kpi-sub">
                 <span>’26년 ${fmtNum(ex2026)}억 대비</span>
                 <span class="delta-badge delta-up">+${fmtNum(exDiff)}억 (+${exRate})</span>
               </div>`
            : `<div class="kpi-value">${fmtNum(groups.length ? +(total2027 / groups.length).toFixed(1) : 0)}억 원</div>
               <div class="kpi-sub"><span>총 ${groups.length}개 투자분야 평균</span></div>`
        }
      </div>

      <div class="kpi-card kpi-purple">
        <div class="kpi-top">
          <span class="kpi-title">최고 예산 증가율 분야</span>
          <span class="kpi-icon">📈</span>
        </div>
        <div class="kpi-value">${maxGrowthGroup ? `${maxGrowthGroup.catNo} +${maxGrowthGroup.rateText}` : "-"}</div>
        <div class="kpi-sub">
          <span>${maxGrowthGroup ? maxGrowthGroup.category : "-"}</span>
          <span class="delta-badge delta-up">+${maxGrowthGroup ? fmtNum(maxGrowthGroup.diff) : 0}억 증액</span>
        </div>
      </div>

      <div class="kpi-card kpi-rose">
        <div class="kpi-top">
          <span class="kpi-title">신규사업 포함 중점분야</span>
          <span class="kpi-icon">✨</span>
        </div>
        <div class="kpi-value">${newActiveCats.length}개 분야 <span style="font-size:15px;font-weight:700;color:#BE123C;">(${newActiveCats.map((c) => c.catNo).join("·")})</span></div>
        <div class="kpi-sub">
          <span>전체 ${groups.length}개 분야 중 ${newActiveCats.length}개 분야 신규사업 포진</span>
        </div>
      </div>
    `;

    // 2. 분야별 차트 렌더링 (Chart 1: 2026 vs 2027 비교 막대, Chart 2: 분야별 증감률 및 예산 비중)
    renderCategoryCharts(groups, total2027);

    // 3. 8대 분야 카드 그리드 렌더링
    const cardsGrid = document.getElementById("categoryCardsGrid");
    cardsGrid.innerHTML = groups
      .map((g) => {
        const isSelected = state.selectedCatNo === g.catNo;
        const sharePct = total2027 > 0 ? ((g.budget2027 / total2027) * 100).toFixed(1) : "0.0";
        return `
          <div class="cat-card ${isSelected ? "selected" : ""}" data-catno="${g.catNo}" style="border-top: 4px solid ${g.meta.color};">
            <div>
              <div class="cat-card-header">
                <span class="cat-num-badge" style="background:${g.meta.lightBg}; color:${g.meta.color}; border:1px solid ${g.meta.border};">
                  ${g.meta.icon} 분야 ${g.catNo}
                </span>
                <span class="delta-badge ${g.rateText === "신규" ? "delta-new" : "delta-up"}">
                  ${g.rateText === "신규" ? "✨ 순수 신규분야" : `▲ ${g.rateText}`}
                </span>
              </div>
              <div class="cat-name">${g.category}</div>
              <div class="cat-goal">${g.meta.goal || ""}</div>
            </div>

            <div>
              <div class="cat-metrics">
                <div class="cat-metric-row">
                  <span class="cat-m-label">2026년 예산</span>
                  <span class="cat-m-val">${fmtNum(g.budget2026)}억 원</span>
                </div>
                <div class="cat-metric-row">
                  <span class="cat-m-label">2027년 예산</span>
                  <span class="cat-m-val highlight" style="color:${g.meta.color};">${fmtNum(g.budget2027)}억 원</span>
                </div>
                <div class="cat-metric-row">
                  <span class="cat-m-label">전년 대비 증감액</span>
                  <span class="cat-m-val" style="color:#15803D; font-size:13.5px;">+${fmtNum(g.diff)}억 원</span>
                </div>
              </div>
              <div class="cat-footer">
                <span>세부항목 <strong>${g.totalItemsCount}건</strong> ${g.newItemsCount > 0 ? `<strong style="color:#E11D48;">(신규 ${g.newItemsCount}건)</strong>` : ""}</span>
                <span>전체 비중 <strong>${sharePct}%</strong> · 상세보기 →</span>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    // 카드 클릭 이벤트 바인딩
    cardsGrid.querySelectorAll(".cat-card").forEach((card) => {
      card.addEventListener("click", () => {
        const clickedCat = card.getAttribute("data-catno");
        state.selectedCatNo = state.selectedCatNo === clickedCat ? "ALL" : clickedCat;
        renderCategoryDashboard();
      });
    });

    // 4. 선택된 분야 드릴다운 상세 박스 렌더링
    renderCategoryDrilldown(groups);

    // 5. 분야별 하단 세부사업 테이블 렌더링
    renderCategoryTable(groups);
  }

  function renderCategoryCharts(groups, total2027) {
    const chartLeftEl = document.getElementById("catCompareChartBox");
    const chartRightEl = document.getElementById("catGrowthChartBox");

    // 스케일 모드에 따라 ①번 포함/제외 필터링
    let displayGroups = groups;
    if (state.catScaleMode === "excludeCat1" && groups.length > 1 && groups.some((g) => g.catNo === "①")) {
      displayGroups = groups.filter((g) => g.catNo !== "①");
    }

    const maxVal = Math.max(...displayGroups.map((g) => Math.max(g.budget2026, g.budget2027)), 1);

    // 왼쪽 차트: 2026 vs 2027 분야별 그룹형 인터랙티브 비교 차트
    chartLeftEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; font-size:12px; color:#475569;">
        <div style="display:flex; gap:14px; align-items:center;">
          <span><span style="display:inline-block;width:10px;height:10px;background:#94A3B8;border-radius:2px;margin-right:5px;"></span>2026년 예산(억원)</span>
          <span><span style="display:inline-block;width:10px;height:10px;background:#2563EB;border-radius:2px;margin-right:5px;"></span>2027년 예산(억원)</span>
        </div>
        <span>${state.catScaleMode === "excludeCat1" && groups.some((g) => g.catNo === "①") ? "※ ① 전작권 전환(121,744억) 제외 상세 스케일" : "※ ①~⑧ 전 분야 포함 스케일"}</span>
      </div>
      <div style="display:flex; flex-direction:column; gap:12px;">
        ${displayGroups
          .map((g) => {
            const w26 = Math.max((g.budget2026 / maxVal) * 100, g.budget2026 > 0 ? 1.5 : 0);
            const w27 = Math.max((g.budget2027 / maxVal) * 100, g.budget2027 > 0 ? 2 : 0);
            return `
              <div style="padding:8px 10px; border-radius:8px; background:#F8FAFC; border:1px solid #EEF2F6; cursor:pointer;" onclick="window.selectCategoryFromChart('${g.catNo}')">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; font-size:12.5px;">
                  <strong style="color:#0F172A;">${g.catNo} ${g.category}</strong>
                  <span style="font-weight:700; color:${g.meta.color};">
                    ’26년 ${fmtNum(g.budget2026)}억 → ’27년 ${fmtNum(g.budget2027)}억
                    <span class="delta-badge ${g.rateText === "신규" ? "delta-new" : "delta-up"}" style="margin-left:4px;">+${fmtNum(g.diff)}억 (${g.rateText})</span>
                  </span>
                </div>
                <div style="display:flex; flex-direction:column; gap:4px;">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:36px; font-size:11px; color:#64748B; text-align:right;">’26년</span>
                    <div style="flex:1; background:#E2E8F0; height:10px; border-radius:999px; overflow:hidden;">
                      <div style="width:${w26}%; height:100%; background:#94A3B8; border-radius:999px; transition:width 0.4s ease;"></div>
                    </div>
                  </div>
                  <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:36px; font-size:11px; color:#1E293B; font-weight:700; text-align:right;">’27년</span>
                    <div style="flex:1; background:#E2E8F0; height:12px; border-radius:999px; overflow:hidden;">
                      <div style="width:${w27}%; height:100%; background:${g.meta.color}; border-radius:999px; transition:width 0.4s ease;"></div>
                    </div>
                  </div>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;

    // 오른쪽 차트: 분야별 증감률(성장률) 순위 & 증감액 비중 분석
    const sortedByGrowth = [...groups].sort((a, b) => {
      if (a.rate === null && b.rate === null) return b.budget2027 - a.budget2027;
      if (a.rate === null) return -1; // 순수 신규 분야 상단 배치
      if (b.rate === null) return 1;
      return b.rate - a.rate;
    });

    const maxRatePct = Math.max(...groups.map((g) => (g.rate !== null ? g.rate * 100 : 100)), 10);

    chartRightEl.innerHTML = `
      <div style="font-size:12px; color:#475569; margin-bottom:12px;">
        전년 대비 예산 증가율(%) 및 순수 신규 편성 분야 순위 (클릭 시 해당 분야 필터)
      </div>
      <div style="display:flex; flex-direction:column; gap:10px;">
        ${sortedByGrowth
          .map((g) => {
            const pct = g.rate !== null ? +(g.rate * 100).toFixed(1) : 100;
            const barWidth = g.rate !== null ? Math.min(100, Math.max((pct / maxRatePct) * 100, 4)) : 100;
            const isNewCat = g.rate === null;
            return `
              <div style="padding:8px 10px; border-radius:8px; background:${isNewCat ? "#FFF1F2" : "#F8FAFC"}; border:1px solid ${isNewCat ? "#FECDD3" : "#EEF2F6"}; cursor:pointer;" onclick="window.selectCategoryFromChart('${g.catNo}')">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px; font-size:12.5px;">
                  <span style="font-weight:700; color:#0F172A;">${g.catNo} ${g.category}</span>
                  <span class="delta-badge ${isNewCat ? "delta-new" : "delta-up"}">
                    ${isNewCat ? `순수 신규 (+${fmtNum(g.budget2027)}억)` : `+${pct}% (+${fmtNum(g.diff)}억)`}
                  </span>
                </div>
                <div style="width:100%; background:#E2E8F0; height:9px; border-radius:999px; overflow:hidden;">
                  <div style="width:${barWidth}%; height:100%; background:${isNewCat ? "linear-gradient(90deg, #F43F5E, #E11D48)" : g.meta.color}; border-radius:999px;"></div>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  window.selectCategoryFromChart = function (catNo) {
    state.selectedCatNo = state.selectedCatNo === catNo ? "ALL" : catNo;
    renderCategoryDashboard();
    const drillEl = document.getElementById("categoryDrilldownBox");
    if (drillEl && state.selectedCatNo !== "ALL") {
      drillEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  };

  function renderCategoryDrilldown(groups) {
    const container = document.getElementById("categoryDrilldownBox");
    if (state.selectedCatNo === "ALL") {
      container.style.display = "none";
      return;
    }
    const g = groups.find((x) => x.catNo === state.selectedCatNo);
    if (!g) {
      container.style.display = "none";
      return;
    }
    container.style.display = "block";
    const nonBudgetList = (state.data.nonBudgetIndicators || []).filter((nb) => nb.catNo === g.catNo);

    container.innerHTML = `
      <div class="drilldown-top">
        <div>
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
            <span class="cat-num-badge" style="background:${g.meta.color}; color:#FFF;">${g.meta.icon} 분야 ${g.catNo} 집중 분석</span>
            <h3 style="font-size:18px; font-weight:800; color:#0F172A;">${g.category}</h3>
          </div>
          <p style="font-size:13px; color:#334155; font-weight:600;">🎯 추진 목표: ${g.meta.goal || "-"}</p>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="text-align:right; background:#FFF; padding:8px 14px; border-radius:8px; border:1px solid #BFDBFE;">
            <div style="font-size:11px; color:#64748B; font-weight:700;">2026년 → 2027년 대표예산</div>
            <div style="font-size:16px; font-weight:800; color:${g.meta.color};">
              ${fmtNum(g.budget2026)}억 → ${fmtNum(g.budget2027)}억 원 (+${fmtNum(g.diff)}억 / ${g.rateText})
            </div>
          </div>
          <button class="btn btn-outline" onclick="window.selectCategoryFromChart('ALL')">✕ 전체 분야 보기</button>
        </div>
      </div>

      ${
        g.meta.bullets && g.meta.bullets.length > 0
          ? `<div style="margin-top:8px;">
               <div style="font-size:12px; font-weight:800; color:#1E40AF; margin-bottom:6px;">📌 보도자료 본문 핵심 추진 내용</div>
               <ul class="drilldown-bullets">
                 ${g.meta.bullets.map((b) => `<li>${b}</li>`).join("")}
               </ul>
             </div>`
          : ""
      }

      ${
        nonBudgetList.length > 0
          ? `<div style="margin-top:14px; padding-top:12px; border-top:1px dashed #93C5FD;">
               <div style="font-size:12px; font-weight:800; color:#0D9488; margin-bottom:8px;">📏 연계 비예산 수치 지표 (인원 · 단가 · 처우개선율)</div>
               <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:10px;">
                 ${nonBudgetList
                   .map(
                     (nb) => `
                   <div style="background:#FFF; border:1px solid #99F6E4; border-radius:8px; padding:10px 12px;">
                     <div style="font-size:12px; font-weight:700; color:#0F172A; margin-bottom:4px;">${nb.indicatorName}</div>
                     <div style="font-size:15px; font-weight:800; color:#0D9488;">
                       ’26년 ${fmtNum(nb.val2026)}${nb.unit} → ’27년 ${fmtNum(nb.val2027)}${nb.unit}
                       <span class="delta-badge ${nb.rateText === "신규" ? "delta-new" : "delta-up"}" style="margin-left:4px;">${nb.rateText}</span>
                     </div>
                     <div style="font-size:11px; color:#64748B; margin-top:3px;">${nb.note}</div>
                   </div>`
                   )
                   .join("")}
               </div>
             </div>`
          : ""
      }
    `;
  }

  function renderCategoryTable(groups) {
    // 분야 필터 셀렉트 옵션 동기화
    const catSelect = document.getElementById("catFilterSelect");
    const currentOpts = `<option value="ALL">전체 분야 (${groups.length}개)</option>` +
      groups.map((g) => `<option value="${g.catNo}" ${state.selectedCatNo === g.catNo ? "selected" : ""}>${g.catNo} ${g.category}</option>`).join("");
    catSelect.innerHTML = currentOpts;

    let filtered = [...(state.data.items || [])];
    if (state.selectedCatNo !== "ALL") {
      filtered = filtered.filter((it) => it.catNo === state.selectedCatNo);
    }
    if (state.catTypeFilter !== "ALL") {
      if (state.catTypeFilter === "NEW") filtered = filtered.filter((it) => it.isNew);
      else if (state.catTypeFilter === "TOTAL") filtered = filtered.filter((it) => String(it.type).includes("총괄"));
      else if (state.catTypeFilter === "DIRECT") filtered = filtered.filter((it) => String(it.type).includes("직접"));
      else if (state.catTypeFilter === "LINKED") filtered = filtered.filter((it) => String(it.type).includes("연계"));
    }
    if (state.catSearchQuery) {
      const q = state.catSearchQuery.toLowerCase();
      filtered = filtered.filter(
        (it) =>
          it.category.toLowerCase().includes(q) ||
          it.projectName.toLowerCase().includes(q) ||
          it.type.toLowerCase().includes(q) ||
          (it.note && it.note.toLowerCase().includes(q))
      );
    }

    // 정렬 적용
    const { key, dir } = state.sortConfig;
    filtered.sort((a, b) => {
      let va = a[key];
      let vb = b[key];
      if (key === "rate") {
        va = a.rate === null ? 999999 : a.rate;
        vb = b.rate === null ? 999999 : b.rate;
      }
      if (typeof va === "number" && typeof vb === "number") {
        return dir === "asc" ? va - vb : vb - va;
      }
      return dir === "asc"
        ? String(va || "").localeCompare(String(vb || ""), "ko")
        : String(vb || "").localeCompare(String(va || ""), "ko");
    });

    const tbody = document.getElementById("catTableBody");
    const tfoot = document.getElementById("catTableFoot");

    const hasTotalRowByCat = new Set(
      (state.data.items || []).filter((i) => String(i.type).includes("총괄")).map((i) => i.catNo)
    );

    let sum26 = 0;
    let sum27 = 0;
    filtered.forEach((it) => {
      const exclude = state.catSumMode === "excludeSub" && it.isSubItem && hasTotalRowByCat.has(it.catNo);
      if (!exclude) {
        sum26 += Number(it.budget2026) || 0;
        sum27 += Number(it.budget2027) || 0;
      }
    });
    const sumDiff = +(sum27 - sum26).toFixed(2);
    const sumRate = sum26 > 0 ? ((sumDiff / sum26) * 100).toFixed(1) + "%" : sum27 > 0 ? "신규" : "-";

    tbody.innerHTML = filtered
      .map((it) => {
        const rowClasses = [];
        if (String(it.type).includes("총괄")) rowClasses.push("row-total-type");
        if (it.isNew) rowClasses.push("row-new-item");
        if (it.isSubItem) rowClasses.push("row-sub-item");

        const excludedNotice =
          state.catSumMode === "excludeSub" && it.isSubItem && hasTotalRowByCat.has(it.catNo)
            ? `<span style="font-size:11px; color:#64748B; margin-left:4px;" title="중점분야 총괄 예산에 포함된 내역사업으로 합계 중복 계산에서 제외됨">(총괄내역)</span>`
            : "";

        return `
          <tr class="${rowClasses.join(" ")}">
            <td class="text-center" style="font-weight:800;">${it.catNo}</td>
            <td class="text-left" style="font-weight:700;">${it.category}</td>
            <td class="text-left col-proj">
              <span style="font-weight:${it.isNew || String(it.type).includes("총괄") ? "700" : "500"};">${it.projectName}</span>
              ${excludedNotice}
            </td>
            <td class="text-center">
              <span class="type-badge ${getTypeBadgeClass(it.type)}">${it.type}</span>
            </td>
            <td class="text-right">${fmtNum(it.budget2026)}</td>
            <td class="text-right" style="font-weight:800;">${fmtNum(it.budget2027)}</td>
            <td class="text-right num-pos">+${fmtNum(it.diff)}</td>
            <td class="text-center">
              ${it.rateText === "신규" ? `<span class="num-new">신규</span>` : `<strong>${it.rateText}</strong>`}
            </td>
            <td class="text-left" style="font-size:12px; color:#475569;">${it.note || ""}</td>
          </tr>
        `;
      })
      .join("");

    tfoot.innerHTML = `
      <tr>
        <td colspan="4" class="text-center">
          표시 항목 합계 (${filtered.length}건 / ${state.catSumMode === "excludeSub" ? "내역사업 중복제외 기준" : "단순 합산 기준"})
        </td>
        <td class="text-right">${fmtNum(sum26)}</td>
        <td class="text-right" style="color:#1D4ED8;">${fmtNum(sum27)}</td>
        <td class="text-right num-pos">+${fmtNum(sumDiff)}</td>
        <td class="text-center">${sumRate}</td>
        <td class="text-left" style="font-size:11.5px; color:#64748B;">단위: 억 원 (${fmtJoEok(sum27)})</td>
      </tr>
    `;
  }

  // =========================================================================
  // TAB 2: 🚀 신규사업별 대시보드 렌더링
  // =========================================================================
  function renderNewProjectsDashboard() {
    const newItems = getNewProjectItems();
    const totalNewBudget = +(newItems.reduce((acc, it) => acc + (Number(it.budget2027) || 0), 0)).toFixed(2);

    // 신규사업 보유 분야별 집계
    const catMap = new Map();
    newItems.forEach((it, idx) => {
      const key = it.catNo || "기타";
      if (!catMap.has(key)) {
        catMap.set(key, {
          catNo: key,
          category: it.category,
          count: 0,
          budget2027: 0,
          items: [],
          meta: getCatMeta(key, idx)
        });
      }
      const entry = catMap.get(key);
      entry.count += 1;
      entry.budget2027 = +(entry.budget2027 + (Number(it.budget2027) || 0)).toFixed(2);
      entry.items.push(it);
    });

    const newCatGroups = Array.from(catMap.values()).sort((a, b) => b.budget2027 - a.budget2027);
    const topCat = newCatGroups[0] || { catNo: "-", category: "-", budget2027: 0, count: 0 };

    // 최대 규모 단일 신규사업
    const sortedNewByBudget = [...newItems].sort((a, b) => b.budget2027 - a.budget2027);
    const topProject = sortedNewByBudget[0] || { projectName: "-", budget2027: 0, category: "-" };
    const topProjShare = totalNewBudget > 0 ? ((topProject.budget2027 / totalNewBudget) * 100).toFixed(1) : "0.0";
    const topCatShare = totalNewBudget > 0 ? ((topCat.budget2027 / totalNewBudget) * 100).toFixed(1) : "0.0";

    // 1. 신규사업 KPI 카드 렌더링
    const newKpiGrid = document.getElementById("newKpiGrid");
    newKpiGrid.innerHTML = `
      <div class="kpi-card kpi-rose">
        <div class="kpi-top">
          <span class="kpi-title">2027년 신규·신설 사업 총액</span>
          <span class="kpi-icon" style="background:#FFE4E6;">🚀</span>
        </div>
        <div class="kpi-value" style="color:#BE123C;">${fmtNum(totalNewBudget)}억 원</div>
        <div class="kpi-sub">
          <span>총 <strong>${newItems.length}건</strong> 신규 편성 (’26년 0원 → ’27년 순증)</span>
          <span class="delta-badge delta-new">신규 100%</span>
        </div>
      </div>

      <div class="kpi-card">
        <div class="kpi-top">
          <span class="kpi-title">단일 최대 규모 신규사업</span>
          <span class="kpi-icon">🏆</span>
        </div>
        <div class="kpi-value">${fmtNum(topProject.budget2027)}억 원</div>
        <div class="kpi-sub">
          <span style="font-weight:700; color:#0F172A;">${topProject.projectName.replace(/^└\s*/, "")}</span>
          <span class="delta-badge delta-up">신규예산의 ${topProjShare}%</span>
        </div>
      </div>

      <div class="kpi-card kpi-purple">
        <div class="kpi-top">
          <span class="kpi-title">최다 신규투자 집중 분야</span>
          <span class="kpi-icon">🔬</span>
        </div>
        <div class="kpi-value">${topCat.catNo} ${fmtNum(topCat.budget2027)}억 원</div>
        <div class="kpi-sub">
          <span>${topCat.category} (${topCat.count}건)</span>
          <span class="delta-badge delta-new">전체의 ${topCatShare}%</span>
        </div>
      </div>

      <div class="kpi-card kpi-teal">
        <div class="kpi-top">
          <span class="kpi-title">신규사업 건당 평균 예산</span>
          <span class="kpi-icon">📐</span>
        </div>
        <div class="kpi-value">${fmtNum(newItems.length ? +(totalNewBudget / newItems.length).toFixed(1) : 0)}억 원</div>
        <div class="kpi-sub">
          <span>${newCatGroups.length}개 중점분야(${newCatGroups.map((c) => c.catNo).join("·")})에 분포</span>
        </div>
      </div>
    `;

    // 2. 신규사업 차트 렌더링 (왼쪽: 신규사업별 예산 순위 바 차트, 오른쪽: 분야별 신규예산 분포 & 편성유형 분석)
    renderNewProjectCharts(sortedNewByBudget, newCatGroups, totalNewBudget);

    // 3. 신규사업 분야 필터 버튼 업데이트
    const filterBar = document.getElementById("newCategoryFilterPills");
    filterBar.innerHTML =
      `<button class="seg-btn seg-rose ${state.newCatFilter === "ALL" ? "active" : ""}" data-cat="ALL">전체 신규사업 (${newItems.length}건 · ${fmtNum(totalNewBudget)}억)</button>` +
      newCatGroups
        .map(
          (cg) =>
            `<button class="seg-btn seg-rose ${state.newCatFilter === cg.catNo ? "active" : ""}" data-cat="${cg.catNo}">
              ${cg.catNo} ${cg.category} (${cg.count}건 · ${fmtNum(cg.budget2027)}억)
            </button>`
        )
        .join("");

    filterBar.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.newCatFilter = btn.getAttribute("data-cat");
        renderNewProjectsDashboard();
      });
    });

    // 필터링 및 정렬 적용
    let displayNew = [...newItems];
    if (state.newCatFilter !== "ALL") {
      displayNew = displayNew.filter((it) => it.catNo === state.newCatFilter);
    }
    if (state.newSearchQuery) {
      const q = state.newSearchQuery.toLowerCase();
      displayNew = displayNew.filter(
        (it) =>
          it.projectName.toLowerCase().includes(q) ||
          it.category.toLowerCase().includes(q) ||
          it.type.toLowerCase().includes(q) ||
          (it.note && it.note.toLowerCase().includes(q))
      );
    }

    const { key: nKey, dir: nDir } = state.newSortConfig;
    displayNew.sort((a, b) => {
      const va = a[nKey];
      const vb = b[nKey];
      if (typeof va === "number" && typeof vb === "number") {
        return nDir === "asc" ? va - vb : vb - va;
      }
      return nDir === "asc"
        ? String(va || "").localeCompare(String(vb || ""), "ko")
        : String(vb || "").localeCompare(String(va || ""), "ko");
    });

    // 4. 신규사업 카드 갤러리 렌더링
    const cardsContainer = document.getElementById("newProjectsCardGrid");
    cardsContainer.innerHTML = displayNew
      .map((it, idx) => {
        const cleanTitle = it.projectName.replace(/^└\s*/, "");
        const share = totalNewBudget > 0 ? ((it.budget2027 / totalNewBudget) * 100).toFixed(1) : "0.0";
        const rank = sortedNewByBudget.findIndex((x) => x.id === it.id) + 1;
        const meta = getCatMeta(it.catNo, idx);

        return `
          <div class="new-proj-card" style="border-top-color:${meta.color};">
            <div>
              <div class="new-proj-top">
                <span class="cat-num-badge" style="background:${meta.lightBg}; color:${meta.color}; border:1px solid ${meta.border}; font-size:11.5px;">
                  ${meta.icon} ${it.catNo} ${it.category}
                </span>
                <span class="new-rank-badge">예산규모 #${rank}위</span>
              </div>
              <div class="new-proj-title">${cleanTitle}</div>
            </div>

            <div>
              <div class="new-proj-amount-box">
                <div>
                  <div style="font-size:11px; color:#9F1239; font-weight:700;">2027년 신규 편성액</div>
                  <div class="new-proj-amount">${fmtNum(it.budget2027)}억 원</div>
                </div>
                <div style="text-align:right;">
                  <span class="type-badge ${getTypeBadgeClass(it.type)}">${it.type}</span>
                  <div class="new-proj-share" style="margin-top:4px;">신규총액 대비 ${share}%</div>
                </div>
              </div>
              <div class="share-bar-bg">
                <div class="share-bar-fill" style="width:${Math.max(parseFloat(share), 3)}%; background:${meta.color};"></div>
              </div>
              <div class="new-proj-note">${it.note || "-"}</div>
            </div>
          </div>
        `;
      })
      .join("");

    // 5. 신규사업 상세 테이블 렌더링
    const newTbody = document.getElementById("newTableBody");
    const newTfoot = document.getElementById("newTableFoot");
    const filteredSum27 = +(displayNew.reduce((acc, i) => acc + (Number(i.budget2027) || 0), 0)).toFixed(2);

    newTbody.innerHTML = displayNew
      .map((it, idx) => {
        const cleanTitle = it.projectName.replace(/^└\s*/, "");
        const share = totalNewBudget > 0 ? ((it.budget2027 / totalNewBudget) * 100).toFixed(1) : "0.0";
        const meta = getCatMeta(it.catNo, idx);
        return `
          <tr class="row-new-item">
            <td class="text-center" style="font-weight:700; color:#64748B;">${idx + 1}</td>
            <td class="text-center" style="font-weight:800; color:${meta.color};">${it.catNo}</td>
            <td class="text-left" style="font-weight:700;">${it.category}</td>
            <td class="text-left" style="font-weight:800; color:#0F172A;">${cleanTitle}</td>
            <td class="text-center"><span class="type-badge ${getTypeBadgeClass(it.type)}">${it.type}</span></td>
            <td class="text-right" style="color:#64748B;">${fmtNum(it.budget2026)}</td>
            <td class="text-right" style="font-weight:800; color:#BE123C; font-size:14px;">${fmtNum(it.budget2027)}</td>
            <td class="text-right num-pos">+${fmtNum(it.diff)}</td>
            <td class="text-center">
              <div class="inline-bar-wrap">
                <div class="inline-bar-track">
                  <div class="inline-bar-fill" style="width:${Math.max(parseFloat(share), 3)}%; background:${meta.color};"></div>
                </div>
                <span style="font-size:11.5px; font-weight:700; min-width:38px; text-align:right;">${share}%</span>
              </div>
            </td>
            <td class="text-left" style="font-size:12px; color:#475569;">${it.note || ""}</td>
          </tr>
        `;
      })
      .join("");

    newTfoot.innerHTML = `
      <tr>
        <td colspan="5" class="text-center">신규·신설 사업(${displayNew.length}건) 예산 합계</td>
        <td class="text-right">0</td>
        <td class="text-right" style="color:#BE123C; font-size:14.5px;">${fmtNum(filteredSum27)}</td>
        <td class="text-right num-pos">+${fmtNum(filteredSum27)}</td>
        <td class="text-center">${totalNewBudget > 0 ? ((filteredSum27 / totalNewBudget) * 100).toFixed(1) + "%" : "100%"}</td>
        <td class="text-left" style="font-size:12px; color:#475569;">2027년 신규·신설 사업 예산 총액 (${fmtNum(filteredSum27)}억 원)</td>
      </tr>
    `;
  }

  function renderNewProjectCharts(sortedNewByBudget, newCatGroups, totalNewBudget) {
    const rankBox = document.getElementById("newRankingChartBox");
    const distBox = document.getElementById("newCategoryDistBox");

    const maxProjBudget = Math.max(...sortedNewByBudget.map((x) => x.budget2027), 1);

    // 왼쪽: 신규사업 예산 규모 Top 순위 차트
    rankBox.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:9px;">
        ${sortedNewByBudget
          .map((it, idx) => {
            const cleanTitle = it.projectName.replace(/^└\s*/, "");
            const w = Math.max((it.budget2027 / maxProjBudget) * 100, 3);
            const share = totalNewBudget > 0 ? ((it.budget2027 / totalNewBudget) * 100).toFixed(1) : "0.0";
            const meta = getCatMeta(it.catNo, idx);
            return `
              <div style="padding:7px 10px; border-radius:8px; background:#F8FAFC; border:1px solid #EEF2F6;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; font-size:12.5px;">
                  <div style="display:flex; align-items:center; gap:6px; overflow:hidden;">
                    <span style="background:${meta.color}; color:#FFF; font-size:10.5px; font-weight:800; padding:1px 6px; border-radius:4px;">#${idx + 1} · ${it.catNo}</span>
                    <strong style="color:#0F172A; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${cleanTitle}</strong>
                  </div>
                  <div style="white-space:nowrap; font-weight:800; color:#BE123C;">
                    ${fmtNum(it.budget2027)}억 원 <span style="font-size:11px; color:#64748B; font-weight:600;">(${share}%)</span>
                  </div>
                </div>
                <div style="width:100%; background:#E2E8F0; height:10px; border-radius:999px; overflow:hidden;">
                  <div style="width:${w}%; height:100%; background:${meta.color}; border-radius:999px;"></div>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;

    // 오른쪽: 분야별 신규사업 비중 도넛(스택 바) + 매트릭스 및 편성구분별 요약
    const typeMap = new Map();
    sortedNewByBudget.forEach((it) => {
      const t = it.type || "기타";
      if (!typeMap.has(t)) typeMap.set(t, { type: t, count: 0, budget: 0 });
      const entry = typeMap.get(t);
      entry.count += 1;
      entry.budget = +(entry.budget + (Number(it.budget2027) || 0)).toFixed(2);
    });
    const typeGroups = Array.from(typeMap.values()).sort((a, b) => b.budget - a.budget);

    distBox.innerHTML = `
      <div style="margin-bottom:18px;">
        <div style="font-size:12.5px; font-weight:800; color:#0F172A; margin-bottom:8px;">
          📊 분야별 신규예산 점유율 (총 ${fmtNum(totalNewBudget)}억 원 = 100%)
        </div>
        <!-- 누적 비율 스택 바 -->
        <div style="display:flex; width:100%; height:24px; border-radius:8px; overflow:hidden; margin-bottom:14px; border:1px solid #CBD5E1;">
          ${newCatGroups
            .map((cg) => {
              const pct = totalNewBudget > 0 ? (cg.budget2027 / totalNewBudget) * 100 : 0;
              return `<div title="${cg.catNo} ${cg.category}: ${fmtNum(cg.budget2027)}억 (${pct.toFixed(1)}%)" style="width:${pct}%; background:${cg.meta.color}; height:100%; transition:width 0.3s;"></div>`;
            })
            .join("")}
        </div>

        <div style="display:flex; flex-direction:column; gap:10px;">
          ${newCatGroups
            .map((cg) => {
              const pct = totalNewBudget > 0 ? ((cg.budget2027 / totalNewBudget) * 100).toFixed(1) : "0.0";
              return `
                <div style="padding:10px 12px; border-radius:8px; background:${cg.meta.lightBg}; border:1px solid ${cg.meta.border}; cursor:pointer;" onclick="window.filterNewByCat('${cg.catNo}')">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <span style="font-weight:800; color:${cg.meta.color}; font-size:13px;">
                      ${cg.meta.icon} ${cg.catNo} ${cg.category}
                    </span>
                    <span style="font-weight:800; color:#0F172A; font-size:14px;">
                      ${fmtNum(cg.budget2027)}억 원 <span class="delta-badge delta-new">${pct}% · ${cg.count}건</span>
                    </span>
                  </div>
                  <div style="font-size:11.5px; color:#475569;">
                    포함 사업: ${cg.items.map((x) => x.projectName.replace(/^└\s*/, "") + `(${fmtNum(x.budget2027)}억)`).join(", ")}
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>

      <div style="padding-top:14px; border-top:1px dashed #CBD5E1;">
        <div style="font-size:12.5px; font-weight:800; color:#0F172A; margin-bottom:8px;">
          🏷️ 예산 편성 구분별 신규사업 분포
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:10px;">
          ${typeGroups
            .map((tg) => {
              const pct = totalNewBudget > 0 ? ((tg.budget / totalNewBudget) * 100).toFixed(1) : "0.0";
              return `
                <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:10px 12px;">
                  <span class="type-badge ${getTypeBadgeClass(tg.type)}" style="margin-bottom:6px;">${tg.type}</span>
                  <div style="font-size:16px; font-weight:800; color:#0F172A;">${fmtNum(tg.budget)}억 원</div>
                  <div style="font-size:11.5px; color:#64748B;">총 ${tg.count}건 · 비중 ${pct}%</div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  window.filterNewByCat = function (catNo) {
    state.newCatFilter = state.newCatFilter === catNo ? "ALL" : catNo;
    renderNewProjectsDashboard();
  };

  // =========================================================================
  // TAB 3: 📋 원본 수치표 · 비예산 지표 · 데이터 편집 렌더링
  // =========================================================================
  function renderRawDataTab() {
    const items = state.data.items || [];
    let filtered = [...items];
    if (state.rawSearchQuery) {
      const q = state.rawSearchQuery.toLowerCase();
      filtered = filtered.filter(
        (it) =>
          it.category.toLowerCase().includes(q) ||
          it.projectName.toLowerCase().includes(q) ||
          it.type.toLowerCase().includes(q) ||
          (it.note && it.note.toLowerCase().includes(q))
      );
    }

    const rawTbody = document.getElementById("rawExcelTableBody");
    rawTbody.innerHTML = filtered
      .map(
        (it) => `
        <tr class="${String(it.type).includes("총괄") ? "row-total-type" : it.isNew ? "row-new-item" : ""}">
          <td class="text-center" style="font-weight:800;">${it.catNo}</td>
          <td class="text-left" style="font-weight:700;">${it.category}</td>
          <td class="text-left">${it.projectName}</td>
          <td class="text-center"><span class="type-badge ${getTypeBadgeClass(it.type)}">${it.type}</span></td>
          <td class="text-right">${fmtNum(it.budget2026)}</td>
          <td class="text-right" style="font-weight:800;">${fmtNum(it.budget2027)}</td>
          <td class="text-right num-pos">+${fmtNum(it.diff)}</td>
          <td class="text-center">${it.rateText === "신규" ? `<span class="num-new">신규</span>` : it.rateText}</td>
          <td class="text-left" style="font-size:12px; color:#475569;">${it.note || ""}</td>
          <td class="text-center">
            <button class="btn btn-outline" style="padding:3px 8px; font-size:11px;" onclick="window.deleteRowItem(${it.id})">삭제</button>
          </td>
        </tr>
      `
      )
      .join("");

    // 비예산 지표 테이블 렌더링
    const nbTbody = document.getElementById("nonBudgetTableBody");
    const nbList = state.data.nonBudgetIndicators || [];
    nbTbody.innerHTML = nbList
      .map(
        (nb) => `
        <tr>
          <td class="text-center" style="font-weight:800;">${nb.catNo}</td>
          <td class="text-left" style="font-weight:700;">${nb.category}</td>
          <td class="text-left" style="font-weight:700;">${nb.indicatorName}</td>
          <td class="text-center">${nb.unit}</td>
          <td class="text-right">${fmtNum(nb.val2026)}</td>
          <td class="text-right" style="font-weight:800; color:#0D9488;">${fmtNum(nb.val2027)}</td>
          <td class="text-right num-pos">+${fmtNum(nb.diff)}</td>
          <td class="text-center">${nb.rateText === "신규" ? `<span class="num-new">신규</span>` : nb.rateText}</td>
          <td class="text-left" style="font-size:12px; color:#475569;">${nb.note || ""}</td>
        </tr>
      `
      )
      .join("");
  }

  window.deleteRowItem = function (id) {
    state.data.items = state.data.items.filter((x) => x.id !== id);
    renderAll();
    showToast("선택한 사업 행이 삭제되었습니다.", "info");
  };

  // 전체 화면 리렌더링
  function renderAll() {
    renderHeaderAndStatus();
    renderCategoryDashboard();
    renderNewProjectsDashboard();
    renderRawDataTab();
  }

  // 파일 업로드 처리 핸들러
  async function handleFileUpload(file) {
    if (!file) return;
    try {
      const result = await window.BudgetParser.parseFile(file);
      state.workbook = result;
      state.data = result.data;
      state.selectedCatNo = "ALL";
      state.newCatFilter = "ALL";

      // 만약 신규사업 추출 전용 파일이 업로드된 경우 자동으로 '신규사업별 대시보드' 탭으로 포커스 이동
      if (result.data.isNewOnlySheet) {
        switchTab("new");
      }
      renderAll();
      showToast(`'${file.name}' (${result.data.items.length}개 사업 항목) 로드 완료!`, "success");
    } catch (err) {
      console.error(err);
      showToast(err.message || "파일 파싱 중 오류가 발생했습니다.", "error");
    }
  }

  // 탭 전환
  function switchTab(tabId) {
    state.activeTab = tabId;
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === tabId);
    });
    document.querySelectorAll(".tab-pane").forEach((pane) => {
      pane.classList.toggle("active", pane.id === `tab-${tabId}`);
    });
  }

  // CSV 내보내기 함수
  function exportCurrentDataToCSV(mode = "all") {
    const items = mode === "new" ? getNewProjectItems() : state.data.items || [];
    const headers = [
      "분야번호",
      "중점 투자사업 분야",
      "박스 내 세부 사업·항목명",
      "구분",
      "2026년 예산(억원)",
      "2027년 예산(억원)",
      "증감액(억원)",
      "증감률",
      "박스 원문 표기 및 참고사항"
    ];

    const escapeCell = (v) => {
      const s = String(v ?? "");
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const csvRows = [
      escapeCell(state.data.title),
      escapeCell(state.data.subtitle),
      "",
      headers.map(escapeCell).join(",")
    ];

    items.forEach((it) => {
      csvRows.push(
        [
          it.catNo,
          it.category,
          it.projectName,
          it.type,
          it.budget2026,
          it.budget2027,
          it.diff,
          it.rateText,
          it.note
        ]
          .map(escapeCell)
          .join(",")
      );
    });

    const csvContent = "\uFEFF" + csvRows.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      mode === "new"
        ? "2027년_국방예산_중점투자사업_신규사업_추출.csv"
        : "2027년_국방예산_중점투자사업_예산수치자료.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("CSV 파일이 다운로드되었습니다.", "success");
  }

  // 이벤트 리스너 초기화
  function initEvents() {
    // 1. 탭 버튼
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        switchTab(btn.getAttribute("data-tab"));
      });
    });

    // 2. 파일 업로드 드롭존 & 인풋
    const dropzone = document.getElementById("uploadDropzone");
    const fileInput = document.getElementById("fileInput");

    dropzone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) {
        handleFileUpload(e.target.files[0]);
        e.target.value = "";
      }
    });

    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => {
      dropzone.classList.remove("dragover");
    });
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFileUpload(e.dataTransfer.files[0]);
      }
    });

    // 3. 다중 시트 선택 변경
    document.getElementById("sheetSelector").addEventListener("change", (e) => {
      const newSheet = e.target.value;
      if (state.workbook && state.workbook.sheets[newSheet]) {
        try {
          const parsed = window.BudgetParser.extractStructuredDataFromRows(
            state.workbook.sheets[newSheet],
            state.workbook.fileName,
            newSheet
          );
          if (parsed.items.length === 0) {
            showToast(`'${newSheet}' 시트에는 표준 예산 수치 행이 없습니다.`, "error");
            return;
          }
          state.workbook.activeSheet = newSheet;
          state.data = parsed;
          renderAll();
          showToast(`시트 '${newSheet}' 데이터를 불러왔습니다.`, "success");
        } catch (err) {
          showToast(err.message, "error");
        }
      }
    });

    // 4. 기본 데이터 복원 버튼
    document.getElementById("btnResetDefault").addEventListener("click", () => {
      state.data = JSON.parse(JSON.stringify(window.DEFAULT_BUDGET_DATA));
      state.workbook = null;
      state.selectedCatNo = "ALL";
      state.newCatFilter = "ALL";
      renderAll();
      showToast("기본 내장 데이터(2027년 국방예산 중점투자사업)로 복원되었습니다.", "info");
    });

    // 5. CSV 다운로드 버튼들
    document.getElementById("btnExportAllCsv").addEventListener("click", () => exportCurrentDataToCSV("all"));
    document.getElementById("btnExportNewCsv").addEventListener("click", () => exportCurrentDataToCSV("new"));

    // 6. 분야별 대시보드 툴바 토글 (합산 기준 & 차트 스케일)
    document.querySelectorAll("[data-sum-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.catSumMode = btn.getAttribute("data-sum-mode");
        document.querySelectorAll("[data-sum-mode]").forEach((b) =>
          b.classList.toggle("active", b.getAttribute("data-sum-mode") === state.catSumMode)
        );
        renderCategoryDashboard();
      });
    });

    document.querySelectorAll("[data-scale-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.catScaleMode = btn.getAttribute("data-scale-mode");
        document.querySelectorAll("[data-scale-mode]").forEach((b) =>
          b.classList.toggle("active", b.getAttribute("data-scale-mode") === state.catScaleMode)
        );
        renderCategoryDashboard();
      });
    });

    // 7. 분야별 테이블 검색 & 필터
    document.getElementById("catFilterSelect").addEventListener("change", (e) => {
      state.selectedCatNo = e.target.value;
      renderCategoryDashboard();
    });
    document.getElementById("catTypeSelect").addEventListener("change", (e) => {
      state.catTypeFilter = e.target.value;
      renderCategoryDashboard();
    });
    document.getElementById("catSearchInput").addEventListener("input", (e) => {
      state.catSearchQuery = e.target.value.trim();
      renderCategoryDashboard();
    });

    // 8. 신규사업 추출 기준 스위치 (9건 1,503억 vs 10건 1,819억)
    document.querySelectorAll("[data-new-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.newFilterMode = btn.getAttribute("data-new-mode");
        document.querySelectorAll("[data-new-mode]").forEach((b) =>
          b.classList.toggle("active", b.getAttribute("data-new-mode") === state.newFilterMode)
        );
        renderHeaderAndStatus();
        renderNewProjectsDashboard();
      });
    });

    document.getElementById("newSearchInput").addEventListener("input", (e) => {
      state.newSearchQuery = e.target.value.trim();
      renderNewProjectsDashboard();
    });

    // 9. 원본 탭 검색 및 신규 행 추가 모달
    document.getElementById("rawSearchInput").addEventListener("input", (e) => {
      state.rawSearchQuery = e.target.value.trim();
      renderRawDataTab();
    });

    const addModal = document.getElementById("addRowModal");
    const fCatNoEl = document.getElementById("fCatNo");
    const fCategoryEl = document.getElementById("fCategory");
    const catNameMap = {
      "①": "전작권 전환 및 자주국방 확충",
      "②": "미래 병력구조 개편 (예비·민간역량)",
      "③": "AI·유무인 복합체계 첨단 전력 전환",
      "④": "드론·대드론 역량 강화",
      "⑤": "장병 복무여건 개선 및 복지 강화",
      "⑥": "미래 국방기술 투자 확대",
      "⑦": "중소·벤처기업 방산 진입 및 성장 지원",
      "⑧": "AI·디지털 국민체감형 병무서비스 확대"
    };
    fCatNoEl.addEventListener("change", () => {
      if (catNameMap[fCatNoEl.value]) {
        fCategoryEl.value = catNameMap[fCatNoEl.value];
      }
    });
    document.getElementById("btnOpenAddModal").addEventListener("click", () => {
      addModal.classList.add("open");
    });
    document.getElementById("btnCloseAddModal").addEventListener("click", () => {
      addModal.classList.remove("open");
    });
    document.getElementById("addRowForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const catNo = document.getElementById("fCatNo").value.trim() || "①";
      const category = document.getElementById("fCategory").value.trim() || "기타 투자분야";
      const projectName = document.getElementById("fProjectName").value.trim();
      const type = document.getElementById("fType").value.trim() || "박스 직접예산";
      const b26 = parseFloat(document.getElementById("fBudget2026").value) || 0;
      const b27 = parseFloat(document.getElementById("fBudget2027").value) || 0;
      const note = document.getElementById("fNote").value.trim();

      if (!projectName) return;

      const diff = +(b27 - b26).toFixed(2);
      const isNew = b26 === 0 || type.includes("신규");
      const isStrictNew = type.includes("신규");
      const isSubItem = projectName.startsWith("└") || type.includes("내역");
      const rate = b26 > 0 ? diff / b26 : null;
      const rateText = isNew && b26 === 0 ? "신규" : b26 > 0 ? (rate * 100).toFixed(1) + "%" : "-";

      state.data.items.push({
        id: Date.now(),
        catNo,
        category,
        projectName,
        type,
        budget2026: b26,
        budget2027: b27,
        diff,
        rate,
        rateText,
        isNew,
        isStrictNew,
        isSubItem,
        note
      });

      addModal.classList.remove("open");
      e.target.reset();
      renderAll();
      showToast(`'${projectName}' 항목이 추가되었습니다.`, "success");
    });

    // 10. 테이블 헤더 정렬 클릭
    document.querySelectorAll("[data-sort-key]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.getAttribute("data-sort-key");
        if (state.sortConfig.key === key) {
          state.sortConfig.dir = state.sortConfig.dir === "asc" ? "desc" : "asc";
        } else {
          state.sortConfig.key = key;
          state.sortConfig.dir = "desc";
        }
        renderCategoryDashboard();
      });
    });

    document.querySelectorAll("[data-new-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.getAttribute("data-new-sort");
        if (state.newSortConfig.key === key) {
          state.newSortConfig.dir = state.newSortConfig.dir === "asc" ? "desc" : "asc";
        } else {
          state.newSortConfig.key = key;
          state.newSortConfig.dir = "desc";
        }
        renderNewProjectsDashboard();
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initEvents();
    renderAll();
  });
})();
