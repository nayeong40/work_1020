// 엑셀(.xlsx, .xls) 및 CSV(.csv) 스마트 파서 (SheetJS + 브라우저 네이티브 XLSX/CSV 폴백 지원)
window.BudgetParser = (function () {
  // 숫자 파싱 헬퍼
  function parseNum(val) {
    if (val === null || val === undefined || val === "") return 0;
    if (typeof val === "number") return isNaN(val) ? 0 : val;
    const cleaned = String(val).replace(/,/g, "").replace(/\+/g, "").replace(/억원/g, "").replace(/억/g, "").trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  // 분야번호 정규화 (1 -> ① 등 지원)
  const CIRCLED_NUMS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
  function normalizeCatNo(raw) {
    if (!raw) return "";
    const s = String(raw).trim();
    if (CIRCLED_NUMS.includes(s)) return s;
    const n = parseInt(s.replace(/[^0-9]/g, ""), 10);
    if (!isNaN(n) && n >= 1 && n <= 10) return CIRCLED_NUMS[n - 1];
    return s;
  }

  // CSV 문자열 -> 2D 배열 파서 (따옴표 내 쉼표 및 줄바꿈 완벽 처리)
  function parseCSVText(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          row.push(cur.trim());
          cur = "";
        } else if (ch === "\r" && next === "\n") {
          row.push(cur.trim());
          rows.push(row);
          row = [];
          cur = "";
          i++;
        } else if (ch === "\n" || ch === "\r") {
          row.push(cur.trim());
          rows.push(row);
          row = [];
          cur = "";
        } else {
          cur += ch;
        }
      }
    }
    if (cur.length > 0 || row.length > 0) {
      row.push(cur.trim());
      rows.push(row);
    }
    return rows;
  }

  // ArrayBuffer에서 UTF-8 / EUC-KR 자동 감지 디코딩
  function decodeCSVBuffer(buffer) {
    const uint8 = new Uint8Array(buffer);
    // UTF-8 BOM 확인
    if (uint8.length >= 3 && uint8[0] === 0xef && uint8[1] === 0xbb && uint8[2] === 0xbf) {
      return new TextDecoder("utf-8").decode(uint8.subarray(3));
    }
    try {
      const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
      return utf8Decoder.decode(uint8);
    } catch (e) {
      // UTF-8 디코딩 실패 시 한글 엑셀 기본 인코딩(EUC-KR / CP949)으로 디코딩
      return new TextDecoder("euc-kr").decode(uint8);
    }
  }

  // 오프라인 환경을 위한 브라우저 네이티브 .xlsx(ZIP + XML) 파서 폴백
  async function parseXlsxNative(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const uint8 = new Uint8Array(arrayBuffer);
    const entries = {};

    // Central Directory 끝(EOCD) 탐색
    let eocdOffset = -1;
    for (let i = uint8.length - 22; i >= Math.max(0, uint8.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset === -1) throw new Error("유효한 XLSX(ZIP) 파일이 아닙니다.");

    const cdEntries = view.getUint16(eocdOffset + 10, true);
    let cdOffset = view.getUint32(eocdOffset + 16, true);

    for (let i = 0; i < cdEntries; i++) {
      if (view.getUint32(cdOffset, true) !== 0x02014b50) break;
      const compression = view.getUint16(cdOffset + 10, true);
      const compSize = view.getUint32(cdOffset + 20, true);
      const nameLen = view.getUint16(cdOffset + 28, true);
      const extraLen = view.getUint16(cdOffset + 30, true);
      const commentLen = view.getUint16(cdOffset + 32, true);
      const localHeaderOffset = view.getUint32(cdOffset + 42, true);
      const fileName = new TextDecoder("utf-8").decode(uint8.subarray(cdOffset + 46, cdOffset + 46 + nameLen));

      const localNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const compData = uint8.subarray(dataStart, dataStart + compSize);

      entries[fileName] = { compression, compData };
      cdOffset += 46 + nameLen + extraLen + commentLen;
    }

    async function readEntryText(name) {
      const entry = entries[name];
      if (!entry) return null;
      if (entry.compression === 0) {
        return new TextDecoder("utf-8").decode(entry.compData);
      } else if (entry.compression === 8 && typeof DecompressionStream !== "undefined") {
        const ds = new DecompressionStream("deflate-raw");
        const writer = ds.writable.getWriter();
        writer.write(entry.compData);
        writer.close();
        const resp = new Response(ds.readable);
        const ab = await resp.arrayBuffer();
        return new TextDecoder("utf-8").decode(ab);
      }
      throw new Error("브라우저에서 압축 해제를 지원하지 않습니다.");
    }

    const parser = new DOMParser();
    // 1. sharedStrings.xml 읽기
    const sharedStrings = [];
    const ssXmlText = await readEntryText("xl/sharedStrings.xml");
    if (ssXmlText) {
      const ssDoc = parser.parseFromString(ssXmlText, "application/xml");
      const siNodes = ssDoc.getElementsByTagName("si");
      for (let i = 0; i < siNodes.length; i++) {
        const tNodes = siNodes[i].getElementsByTagName("t");
        let str = "";
        for (let j = 0; j < tNodes.length; j++) {
          str += tNodes[j].textContent || "";
        }
        sharedStrings.push(str);
      }
    }

    // 2. workbook.xml 읽기
    const wbXmlText = await readEntryText("xl/workbook.xml");
    const sheetNames = [];
    if (wbXmlText) {
      const wbDoc = parser.parseFromString(wbXmlText, "application/xml");
      const sNodes = wbDoc.getElementsByTagName("sheet");
      for (let i = 0; i < sNodes.length; i++) {
        sheetNames.push(sNodes[i].getAttribute("name") || `Sheet${i + 1}`);
      }
    }

    // 셀 참조(A1, B2...)에서 열 인덱스(0-based) 계산
    function colRefToIndex(ref) {
      if (!ref) return -1;
      const letters = ref.replace(/[0-9]/g, "");
      let idx = 0;
      for (let i = 0; i < letters.length; i++) {
        idx = idx * 26 + (letters.charCodeAt(i) - 64);
      }
      return idx - 1;
    }

    // 3. 각 시트 읽기
    const sheets = {};
    const sheetKeys = Object.keys(entries)
      .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
      .sort();

    for (let idx = 0; idx < sheetKeys.length; idx++) {
      const sKey = sheetKeys[idx];
      const sName = sheetNames[idx] || `Sheet${idx + 1}`;
      const sXmlText = await readEntryText(sKey);
      const sDoc = parser.parseFromString(sXmlText, "application/xml");
      const rowNodes = sDoc.getElementsByTagName("row");
      const rows2D = [];

      for (let r = 0; r < rowNodes.length; r++) {
        const cNodes = rowNodes[r].getElementsByTagName("c");
        const rowArr = [];
        for (let c = 0; c < cNodes.length; c++) {
          const cell = cNodes[c];
          const ref = cell.getAttribute("r");
          const cIdx = colRefToIndex(ref);
          const t = cell.getAttribute("t");
          const vNode = cell.getElementsByTagName("v")[0];
          const isNode = cell.getElementsByTagName("is")[0];
          let val = "";
          if (t === "s" && vNode) {
            val = sharedStrings[parseInt(vNode.textContent, 10)] ?? "";
          } else if (t === "inlineStr" && isNode) {
            val = isNode.textContent || "";
          } else if (vNode) {
            val = vNode.textContent || "";
          }
          if (cIdx >= 0) {
            while (rowArr.length < cIdx) rowArr.push("");
            rowArr[cIdx] = val;
          } else {
            rowArr.push(val);
          }
        }
        rows2D.push(rowArr);
      }
      sheets[sName] = rows2D;
    }
    return { sheetNames: Object.keys(sheets), sheets };
  }

  // 2D 행 배열에서 예산 데이터 및 비예산 지표 구조화 추출
  function extractStructuredDataFromRows(rows, fileName, sheetName) {
    let title = "";
    let subtitle = "";
    const items = [];
    const nonBudgetIndicators = [];

    // 상단 타이틀/출처 탐색
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      const firstCell = String(rows[i]?.[0] || "").trim();
      if (!firstCell) continue;
      if (!title && (firstCell.includes("국방예산") || firstCell.includes("투자사업") || firstCell.includes("현황"))) {
        title = firstCell;
      } else if (!subtitle && (firstCell.startsWith("※") || firstCell.includes("출처") || firstCell.includes("단위"))) {
        subtitle = firstCell;
      }
    }

    // 헤더 행 탐색
    let headerRowIdx = -1;
    let colMap = null;
    let isNewExtractFormat = false;

    for (let i = 0; i < Math.min(15, rows.length); i++) {
      const r = (rows[i] || []).map((c) => String(c || "").trim());
      const joined = r.join("|");
      if (
        (joined.includes("분야") && (joined.includes("사업") || joined.includes("항목") || joined.includes("예산"))) ||
        (joined.includes("2026") && joined.includes("2027"))
      ) {
        headerRowIdx = i;
        colMap = {};
        r.forEach((colName, cIdx) => {
          const clean = colName.replace(/\s+/g, "");
          if (clean.includes("연번") || clean === "순번" || clean === "번호") colMap.seq = cIdx;
          else if (clean.includes("분야번호") || clean === "분야순번") colMap.catNo = cIdx;
          else if (clean.includes("투자사업분야") || clean === "분야명" || clean === "중점분야" || clean === "분야") {
            if (colMap.catNo === undefined && clean === "분야") colMap.category = cIdx;
            else colMap.category = cIdx;
          } else if (clean.includes("사업·항목명") || clean.includes("사업명") || clean.includes("항목명") || clean.includes("세부사업")) {
            colMap.projectName = cIdx;
            if (clean.includes("신규·신설") || clean.includes("신규사업")) isNewExtractFormat = true;
          } else if (clean === "구분" || clean.includes("예산구분")) {
            colMap.type = cIdx;
          } else if (clean.includes("2026") || clean.includes("26년")) {
            colMap.budget2026 = cIdx;
          } else if (clean.includes("2027") || clean.includes("27년")) {
            colMap.budget2027 = cIdx;
          } else if (clean.includes("증감액") || clean.includes("증감폭")) {
            colMap.diff = cIdx;
          } else if (clean.includes("증감률") || clean.includes("비고(신규")) {
            colMap.rate = cIdx;
          } else if (clean.includes("원문") || clean.includes("참고사항") || clean === "비고") {
            colMap.note = cIdx;
          }
        });
        break;
      }
    }

    // 만약 표준 헤더를 못 찾았다면 기본 열 인덱스 매핑 시도
    if (headerRowIdx === -1) {
      headerRowIdx = 0;
      colMap = {
        catNo: 0,
        category: 1,
        projectName: 2,
        type: 3,
        budget2026: 4,
        budget2027: 5,
        diff: 6,
        rate: 7,
        note: 8
      };
    }

    // 본문 데이터 행 파싱 및 하단 [참고] 비예산 지표 영역 분리
    let inNonBudgetSection = false;
    let nonBudgetHeaderIdx = -1;
    let lastCatNo = "";
    let lastCategory = "";

    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const firstCell = String(r[0] || "").trim();
      const rowText = r.map((x) => String(x || "").trim()).join(" ");

      if (!rowText) continue;

      // 하단 비예산 수치 지표 섹션 시작 감지
      if (firstCell.includes("[참고]") && (firstCell.includes("비예산") || firstCell.includes("지표"))) {
        inNonBudgetSection = true;
        continue;
      }

      if (inNonBudgetSection) {
        if (nonBudgetHeaderIdx === -1 && (rowText.includes("지표명") || rowText.includes("단위"))) {
          nonBudgetHeaderIdx = i;
          continue;
        }
        if (nonBudgetHeaderIdx !== -1) {
          // 연번 열이 앞에 있는 경우(신규사업 추출 시트 하단)와 없는 경우(시트1 하단) 모두 대응
          const hasSeqCol = /^\d+$/.test(firstCell) && CIRCLED_NUMS.includes(String(r[1] || "").trim());
          const offset = hasSeqCol ? 1 : 0;
          const nbCatNo = normalizeCatNo(r[offset]);
          const nbCategory = String(r[offset + 1] || "").trim();
          const indicatorName = String(r[offset + 2] || "").trim();
          const unit = String(r[offset + 3] || "").trim();
          if (!indicatorName) continue;
          const val2026 = parseNum(r[offset + 4]);
          const val2027 = parseNum(r[offset + 5]);
          const diff = r[offset + 6] !== undefined && r[offset + 6] !== "" ? parseNum(r[offset + 6]) : +(val2027 - val2026).toFixed(2);
          const rawRate = String(r[offset + 7] ?? "").trim();
          let rateText = rawRate;
          if (rawRate && !isNaN(Number(rawRate)) && !rawRate.includes("%")) {
            rateText = (Number(rawRate) * 100).toFixed(1) + "%";
          }
          const note = String(r[offset + 8] || "").trim();
          nonBudgetIndicators.push({
            catNo: nbCatNo || "기타",
            category: nbCategory || "기타",
            indicatorName,
            unit,
            val2026,
            val2027,
            diff,
            rateText: rateText || (val2026 === 0 ? "신규" : ((diff / val2026) * 100).toFixed(1) + "%"),
            note
          });
        }
        continue;
      }

      // 합계 행이나 주석 행은 건너뜀
      if (
        firstCell.includes("합계") ||
        firstCell.includes("총계") ||
        firstCell.startsWith("※") ||
        firstCell.startsWith("[참고]")
      ) {
        continue;
      }

      let rawCatNo = colMap.catNo !== undefined ? String(r[colMap.catNo] || "").trim() : "";
      let category = colMap.category !== undefined ? String(r[colMap.category] || "").trim() : "";
      const projectName = colMap.projectName !== undefined ? String(r[colMap.projectName] || "").trim() : "";
      const type = colMap.type !== undefined ? String(r[colMap.type] || "").trim() : "일반사업";

      if (!projectName) continue;

      // 병합 셀 등으로 분야번호/분야명이 비어있으면 직전 행 값 계승
      const catNo = normalizeCatNo(rawCatNo) || lastCatNo || "기타";
      if (!category && lastCategory) category = lastCategory;
      lastCatNo = catNo;
      lastCategory = category;

      const budget2026 = parseNum(r[colMap.budget2026]);
      const budget2027 = parseNum(r[colMap.budget2027]);
      const diff =
        colMap.diff !== undefined && r[colMap.diff] !== "" && r[colMap.diff] !== undefined
          ? parseNum(r[colMap.diff])
          : +(budget2027 - budget2026).toFixed(2);

      const rawRate = colMap.rate !== undefined ? r[colMap.rate] : "";
      const rawRateStr = String(rawRate ?? "").trim();
      const note = colMap.note !== undefined ? String(r[colMap.note] || "").trim() : "";

      // 신규 사업 판별:
      // 1) isNew: 증감률이 '신규'이거나, 구분에 '신규'가 포함되거나, 2026년 예산이 0이고 2027년 예산 > 0인 경우
      // 2) isStrictNew: 구분에 '신규'가 명시된 경우 또는 신규사업 추출 시트에서 로드된 경우 (9대 신규·신설 사업 1,503억 기준)
      const isRateNew = rawRateStr.includes("신규") || (budget2026 === 0 && budget2027 > 0);
      const isTypeNew = type.includes("신규") || projectName.includes("신설") || projectName.includes("신규") || isNewExtractFormat;
      const isNew = isRateNew || isTypeNew;
      const isStrictNew = type.includes("신규") || isNewExtractFormat;

      // 내역사업(총괄 예산의 하위 내역 여부) 판별: 사업명이 '└'로 시작하거나 구분에 '내역'이 포함된 경우
      const isSubItem = projectName.trim().startsWith("└") || type.includes("내역");

      let rate = null;
      let rateText = "";
      if (rawRateStr.includes("신규") || (budget2026 === 0 && budget2027 > 0)) {
        rate = null;
        rateText = "신규";
      } else if (rawRateStr.endsWith("%")) {
        rate = parseFloat(rawRateStr) / 100;
        rateText = rawRateStr;
      } else if (rawRateStr !== "" && !isNaN(Number(rawRateStr))) {
        const numR = Number(rawRateStr);
        // 엑셀 소수점 비율(예: 0.34938) vs 이미 퍼센트 수치인 경우 구분
        if (Math.abs(numR) <= 10) {
          rate = numR;
          rateText = (numR * 100).toFixed(1) + "%";
        } else {
          rate = numR / 100;
          rateText = numR.toFixed(1) + "%";
        }
      } else if (budget2026 > 0) {
        rate = (budget2027 - budget2026) / budget2026;
        rateText = (rate * 100).toFixed(1) + "%";
      } else {
        rateText = "-";
      }

      items.push({
        id: items.length + 1,
        catNo,
        category: category || `분야 ${catNo}`,
        projectName,
        type,
        budget2026,
        budget2027,
        diff,
        rate,
        rateText,
        isNew,
        isStrictNew,
        isSubItem,
        note
      });
    }

    return {
      title: title || "국방예산 중점 투자사업 예산 대시보드",
      subtitle: subtitle || `업로드 파일: ${fileName}${sheetName ? ` (${sheetName})` : ""} | 단위: 억 원`,
      fileName: sheetName ? `${fileName} [${sheetName}]` : fileName,
      isNewOnlySheet: isNewExtractFormat,
      items,
      nonBudgetIndicators:
        nonBudgetIndicators.length > 0 ? nonBudgetIndicators : window.DEFAULT_BUDGET_DATA.nonBudgetIndicators,
      categoryDetails: Object.assign({}, window.DEFAULT_BUDGET_DATA.categoryDetails)
    };
  }

  // 시트2 (2_중점투자사업_세부내용정리)가 있을 경우 세부 추진목표/불릿 업데이트
  function enrichCategoryDetailsFromSheet2(rows, categoryDetails) {
    if (!rows || rows.length < 4) return;
    for (let i = 3; i < rows.length; i++) {
      const r = rows[i] || [];
      const catNo = normalizeCatNo(r[0]);
      const goal = String(r[1] || "").trim();
      const bulletsRaw = String(r[6] || "").trim();
      if (catNo && goal) {
        if (!categoryDetails[catNo]) {
          categoryDetails[catNo] = {
            color: "#2563EB",
            lightBg: "#EFF6FF",
            border: "#BFDBFE",
            icon: "📌",
            goal: "",
            bullets: []
          };
        }
        categoryDetails[catNo].goal = goal;
        if (bulletsRaw) {
          const lines = bulletsRaw
            .split(/\r?\n/)
            .map((line) => line.replace(/^[•·\-※]\s*/, "").trim())
            .filter(Boolean);
          if (lines.length > 0) categoryDetails[catNo].bullets = lines;
        }
      }
    }
  }

  // 파일 객체(.xlsx, .xls, .csv)를 받아 파싱 결과 반환
  async function parseFile(file) {
    const buffer = await file.arrayBuffer();
    const ext = file.name.split(".").pop().toLowerCase();

    if (ext === "csv" || ext === "txt") {
      const text = decodeCSVBuffer(buffer);
      const rows = parseCSVText(text);
      const parsed = extractStructuredDataFromRows(rows, file.name, "");
      if (parsed.items.length === 0) {
        throw new Error("CSV 파일에서 유효한 예산 항목 행을 찾지 못했습니다. 헤더 구성을 확인해주세요.");
      }
      return {
        sheets: { Default: rows },
        sheetNames: ["Default"],
        activeSheet: "Default",
        data: parsed
      };
    }

    // Excel (.xlsx / .xls) 처리
    let workbookSheets = {};
    let sheetNames = [];

    if (typeof window.XLSX !== "undefined") {
      const wb = window.XLSX.read(buffer, { type: "array" });
      sheetNames = wb.SheetNames;
      sheetNames.forEach((sName) => {
        const ws = wb.Sheets[sName];
        workbookSheets[sName] = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      });
    } else {
      const nativeWb = await parseXlsxNative(buffer);
      sheetNames = nativeWb.sheetNames;
      workbookSheets = nativeWb.sheets;
    }

    // 가장 적합한 예산 수치 시트 자동 선택 (1_박스기준_예산수치자료 또는 신규사업 시트 우선)
    let targetSheet = sheetNames[0];
    for (const name of sheetNames) {
      if (name.includes("예산수치") || name.includes("박스기준") || name.includes("신규사업")) {
        targetSheet = name;
        break;
      }
    }

    const parsed = extractStructuredDataFromRows(workbookSheets[targetSheet], file.name, targetSheet);

    // 만약 2_중점투자사업_세부내용정리 시트가 함께 존재하면 추진목표·세부내용 보강
    const detailSheetName = sheetNames.find((n) => n.includes("세부내용"));
    if (detailSheetName && workbookSheets[detailSheetName]) {
      enrichCategoryDetailsFromSheet2(workbookSheets[detailSheetName], parsed.categoryDetails);
    }

    if (parsed.items.length === 0) {
      throw new Error(`선택된 시트(${targetSheet})에서 예산 데이터 행을 찾지 못했습니다.`);
    }

    return {
      sheets: workbookSheets,
      sheetNames,
      activeSheet: targetSheet,
      fileName: file.name,
      data: parsed
    };
  }

  return {
    parseFile,
    extractStructuredDataFromRows,
    enrichCategoryDetailsFromSheet2,
    parseNum,
    normalizeCatNo
  };
})();
