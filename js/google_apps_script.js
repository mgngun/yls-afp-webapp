/**
 * ============================================================================
 * YLS LFA AFP 진단 키트 - Google Apps Script (GAS) 백엔드 코드
 * 구글 시트 저장/수정 + 휴지통 보관 & 7일 자동 영구 삭제 & 복원 지원 (v4.7.1)
 * ============================================================================
 * 
 * [설정된 구글 리소스]
 * 1. 스프레드시트: https://docs.google.com/spreadsheets/d/1ckyAywMytLJCClUgwizQakq5xdQmm_5fNeQYSW4S3jo/edit
 * 2. 이미지 저장 드라이브 폴더: https://drive.google.com/drive/u/0/folders/1U-3jUSs7tutgovrNeOZE7P5Y_KuBqlwI
 *    - 폴더 ID: 1U-3jUSs7tutgovrNeOZE7P5Y_KuBqlwI
 * 
 * [배포 및 권한 승인 필수 3단계]
 * 1. 스프레드시트 상단 [확장 프로그램] -> [Apps Script] 클릭 후 이 파일 전체 내용 붙여넣기
 * 2. [중요] 상단 툴바의 실행 함수를 'testDrivePermission'으로 선택 후 [실행(▶)] 클릭
 *    -> "권한 검토" 팝업 뜨면 -> [고급] -> [안전하지 않음(으)로 이동] -> [허용] 클릭 (드라이브 권한 승인 완료)
 * 3. 오른쪽 상단 [배포] -> [배포 관리] -> [연필 아이콘(수정)] -> 버전: [새 버전] 선택 -> [배포] 클릭
 * ============================================================================
 */

// 이미지 저장 대상 구글 드라이브 폴더 ID
var DRIVE_FOLDER_ID = "1U-3jUSs7tutgovrNeOZE7P5Y_KuBqlwI";

/**
 * [권한 승인 전용 함수]
 */
function testDrivePermission() {
  if (DRIVE_FOLDER_ID) {
    var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    Logger.log("성공! 드라이브 폴더 연결 확인: " + folder.getName());
  }
}

/**
 * [메인 시트 탐색 헬퍼]
 * Trash(휴지통)나 Users 등 보조 시트가 활성화되어 있어도 항상 메인 검사기록 시트를 정확하게 반환합니다.
 */
function getMainSheet(ss) {
  var sheet = ss.getSheetByName("Sheet1") || ss.getSheetByName("시트1");
  if (!sheet) {
    var all = ss.getSheets();
    for (var i = 0; i < all.length; i++) {
      var n = all[i].getName();
      if (n !== "Trash" && n !== "휴지통" && n !== "Users") {
        return all[i];
      }
    }
    sheet = all[0];
  }
  return sheet;
}

/**
 * [7일 경과 휴지통 자동 영구 삭제 헬퍼]
 */
function purgeExpiredTrash(trashSheet) {
  if (!trashSheet) return;
  var lastRow = trashSheet.getLastRow();
  if (lastRow <= 1) return;
  var now = new Date().getTime();
  var SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  
  var values = trashSheet.getRange(2, 10, lastRow - 1, 1).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    var rawDel = values[i][0];
    if (rawDel) {
      var delTime = new Date(rawDel).getTime();
      if (!isNaN(delTime) && (now - delTime) > SEVEN_DAYS_MS) {
        trashSheet.deleteRow(i + 2);
      }
    }
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(30000);
  
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getMainSheet(ss);
    
    // 첫 행(헤더)이 비어있으면 기본 헤더 자동 생성
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "timestamp", 
        "User_ID", 
        "C_line", 
        "T_line", 
        "result", 
        "value", 
        "error", 
        "Memo", 
        "Crop_image"
      ]);
      sheet.getRange(1, 1, 1, 9).setFontWeight("bold").setBackground("#e2e8f0");
    }
    
    var data = {};
    if (e && e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch (err) {
        data = e.parameter || {};
      }
    } else if (e && e.parameter) {
      data = e.parameter;
    }

    // ─────────────────────────────────────────────────────────────
    // [ACTION: moveToTrash] 검사 결과를 휴지통 시트로 이동
    // ─────────────────────────────────────────────────────────────
    if (data.action === "moveToTrash") {
      var trashSheet = ss.getSheetByName("Trash");
      if (!trashSheet) {
        trashSheet = ss.insertSheet("Trash");
        trashSheet.appendRow([
          "timestamp", "User_ID", "C_line", "T_line", "result", "value", "error", "Memo", "Crop_image", "deletedAt"
        ]);
        trashSheet.getRange(1, 1, 1, 10).setFontWeight("bold").setBackground("#fee2e2");
      }

      // 7일 만료된 오래된 휴지통 항목 자동 영구 삭제
      purgeExpiredTrash(trashSheet);

      var items = data.items || [];
      var movedCount = 0;
      var lastRow = sheet.getLastRow();

      if (lastRow > 1 && items.length > 0) {
        var displayValues = sheet.getRange(2, 1, lastRow - 1, 9).getDisplayValues();
        var rawValues = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
        var formulas = sheet.getRange(2, 9, lastRow - 1, 1).getFormulas();

        function normalizeDateDigits(val) {
          if (!val) return "";
          if (val instanceof Date) return Utilities.formatDate(val, "Asia/Seoul", "yyyyMMddHHmmss");
          return String(val).replace(/\D/g, "").slice(0, 14);
        }

        var targetMap = {};
        items.forEach(function(it) {
          var dig = normalizeDateDigits(it.timestamp);
          if (dig) {
            targetMap[dig] = it.deletedAt || new Date().toISOString();
            targetMap[dig.slice(0, 12)] = it.deletedAt || new Date().toISOString();
          }
        });

        // 역순(아래 행부터)으로 검색하여 삭제 시 행 번호 밀림 방지
        for (var i = displayValues.length - 1; i >= 0; i--) {
          var rowTs = displayValues[i][0];
          var rawTs = rawValues[i][0];
          var d1 = normalizeDateDigits(rowTs);
          var d2 = normalizeDateDigits(rawTs);

          var matchDel = targetMap[d1] || targetMap[d2] || targetMap[d1.slice(0, 12)] || targetMap[d2.slice(0, 12)];

          if (matchDel) {
            var rowData = displayValues[i];
            var cropForm = formulas[i] && formulas[i][0];

            // Trash 시트에 추가 (9개 열 데이터 + deletedAt)
            trashSheet.appendRow([
              rowData[0], rowData[1], rowData[2], rowData[3], rowData[4],
              rowData[5], rowData[6], rowData[7], cropForm || rowData[8], matchDel
            ]);

            // 원본 시트에서 삭제
            sheet.deleteRow(i + 2);
            movedCount++;
          }
        }
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        action: "moveToTrash",
        movedCount: movedCount
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // ─────────────────────────────────────────────────────────────
    // [ACTION: restoreFromTrash] 휴지통에서 원래 시트로 복원
    // ─────────────────────────────────────────────────────────────
    if (data.action === "restoreFromTrash") {
      var trashSheet = ss.getSheetByName("Trash");
      var restoredCount = 0;

      if (trashSheet && trashSheet.getLastRow() > 1) {
        var items = data.items || [];
        function normalizeDateDigits(val) {
          if (!val) return "";
          if (val instanceof Date) return Utilities.formatDate(val, "Asia/Seoul", "yyyyMMddHHmmss");
          return String(val).replace(/\D/g, "").slice(0, 14);
        }

        var targetMap = {};
        items.forEach(function(it) {
          var dig = normalizeDateDigits(it.timestamp);
          if (dig) {
            targetMap[dig] = true;
            targetMap[dig.slice(0, 12)] = true;
          }
        });

        var trashLastRow = trashSheet.getLastRow();
        var trashValues = trashSheet.getRange(2, 1, trashLastRow - 1, 9).getDisplayValues();
        var trashRaw = trashSheet.getRange(2, 1, trashLastRow - 1, 9).getValues();
        var trashFormulas = trashSheet.getRange(2, 9, trashLastRow - 1, 1).getFormulas();

        for (var j = trashValues.length - 1; j >= 0; j--) {
          var tTs = trashValues[j][0];
          var tRaw = trashRaw[j][0];
          var td1 = normalizeDateDigits(tTs);
          var td2 = normalizeDateDigits(tRaw);

          if (targetMap[td1] || targetMap[td2] || targetMap[td1.slice(0, 12)] || targetMap[td2.slice(0, 12)]) {
            var tRow = trashValues[j];
            var tCrop = (trashFormulas[j] && trashFormulas[j][0]) || tRow[8];

            // 원본 시트에 다시 추가
            sheet.appendRow([
              tRow[0], tRow[1], tRow[2], tRow[3], tRow[4],
              tRow[5], tRow[6], tRow[7], tCrop
            ]);

            // Trash 시트에서 제거
            trashSheet.deleteRow(j + 2);
            restoredCount++;
          }
        }
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        action: "restoreFromTrash",
        restoredCount: restoredCount
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // 1. 기본 필드 추출
    var timestamp   = data.timestamp || Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
    var userId      = data.User_ID || data.userId || "guest";
    var cLine       = data.C_line || data.cLine || "ok";
    var tLine       = data.T_line || data.tLine || "none";
    var result      = data.result || "negative";
    var value       = data.value !== undefined ? data.value : "";
    var errorMsg    = data.error || "";
    var memo        = data.Memo || data.memo || "";
    var rawFilename = data.crop_filename || data.Crop_image || data.cropFilename || (userId + "_" + Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMddHHmmss") + ".jpg");
    
    if (rawFilename.indexOf(".jpg") === -1 && rawFilename.indexOf(".png") === -1) {
      rawFilename += ".jpg";
    }

    // 2. 구글 드라이브에 이미지 파일 저장 (URL인 경우 재업로드 스킵)
    var imageBase64 = data.crop_image_base64 || data.cropImageBase64 || data.imageBase64 || "";
    var driveFileUrl   = "";
    var driveFileId    = data.driveFileId || "";
    var isDriveSuccess = false;
    
    if (imageBase64 && DRIVE_FOLDER_ID) {
      if (imageBase64.indexOf("http") === 0) {
        // 이미 URL인 경우 드라이브 재업로드 불필요
        driveFileUrl = imageBase64;
        isDriveSuccess = true;
      } else {
        try {
          var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
          var pureBase64 = imageBase64;
          if (pureBase64.indexOf("base64,") > -1) {
            pureBase64 = pureBase64.split("base64,")[1];
          }
          
          var decodedBytes = Utilities.base64Decode(pureBase64);
          var blob = Utilities.newBlob(decodedBytes, "image/jpeg", rawFilename);
          var file = folder.createFile(blob);
          
          try {
            file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          } catch (_) {}
          
          driveFileId    = file.getId();
          driveFileUrl   = "https://drive.google.com/file/d/" + driveFileId + "/view";
          isDriveSuccess = true;
        } catch (driveErr) {
          errorMsg = (errorMsg ? errorMsg + " | " : "") + "DriveErr: " + driveErr.toString();
        }
      }
    }

    // 3. 기존 행 존재 여부 검색 (중복 방지 & 재분석 덮어쓰기 업데이트)
    var lastRowIdx = sheet.getLastRow();
    var targetRow = -1;

    function toDigits(s) {
      if (!s) return "";
      if (s instanceof Date) return Utilities.formatDate(s, "Asia/Seoul", "yyyyMMddHHmm");
      var m = String(s).match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})[\sT.]+(\d{1,2}):(\d{1,2})/);
      if (m) {
        var pad = function(n) { return (n.length < 2 ? "0" + n : n); };
        return m[1] + pad(m[2]) + pad(m[3]) + pad(m[4]) + pad(m[5]);
      }
      return String(s).replace(/\D/g, "").slice(0, 12);
    }

    var targetDigits = toDigits(timestamp);

    // [1순위 매칭] 클라이언트가 넘겨준 rowIndex 검증 (타임스탬프 또는 유저ID 일치 시 신뢰)
    var reqRowIndex = data.rowIndex || data.rowNumber;
    if (reqRowIndex && Number(reqRowIndex) >= 2 && Number(reqRowIndex) <= lastRowIdx) {
      var checkRow = Number(reqRowIndex);
      var checkTsVal = sheet.getRange(checkRow, 1).getValue();
      var checkTsDisp = sheet.getRange(checkRow, 1).getDisplayValue();
      var checkUser = String(sheet.getRange(checkRow, 2).getDisplayValue() || "").trim();
      var cDig1 = toDigits(checkTsVal);
      var cDig2 = toDigits(checkTsDisp);

      if ((targetDigits && (cDig1 === targetDigits || cDig2 === targetDigits)) || (checkUser && checkUser === userId)) {
        targetRow = checkRow;
      }
    }

    // [2순위 매칭] 전체 행 대상 다중 조건 정밀 검색 (드라이브ID / 파일명 / 정규화 일시+사용자)
    if (targetRow === -1 && lastRowIdx > 1) {
      var rawValues = sheet.getRange(2, 1, lastRowIdx - 1, 9).getValues();
      var displayValues = sheet.getRange(2, 1, lastRowIdx - 1, 9).getDisplayValues();
      var formulas = sheet.getRange(2, 9, lastRowIdx - 1, 1).getFormulas();

      for (var i = displayValues.length - 1; i >= 0; i--) {
        var rowNum = i + 2;
        var rowTsVal = rawValues[i][0];
        var rowTsDisp = displayValues[i][0];
        var rowUser = (displayValues[i][1] || "").trim();
        var rowCrop = (displayValues[i][8] || "").trim();
        var rowFormula = (formulas[i] && formulas[i][0]) || "";

        // 1) 드라이브 File ID 일치
        if (driveFileId && (rowFormula.indexOf(driveFileId) !== -1 || rowCrop.indexOf(driveFileId) !== -1)) {
          targetRow = rowNum;
          break;
        }

        // 2) 파일명 일치
        if (rawFilename && rowCrop && (rowCrop.indexOf(rawFilename) !== -1 || rawFilename.indexOf(rowCrop) !== -1)) {
          targetRow = rowNum;
          break;
        }

        // 3) 정규화된 날짜/시간(분 단위) + 사용자 ID 일치
        var rDig1 = toDigits(rowTsVal);
        var rDig2 = toDigits(rowTsDisp);
        var isTimeMatch = targetDigits && (rDig1 === targetDigits || rDig2 === targetDigits);
        var isUserMatch = !userId || !rowUser || (rowUser === userId);

        if (isTimeMatch && isUserMatch) {
          targetRow = rowNum;
          break;
        }
      }
    }

    var isUpdated = false;
    if (targetRow > 0) {
      // [기존 행 덮어쓰기 업데이트]
      isUpdated = true;
      sheet.getRange(targetRow, 3).setValue(cLine || "ok");
      sheet.getRange(targetRow, 4).setValue(tLine || "none");
      sheet.getRange(targetRow, 5).setValue(result || "negative");
      // 양성이면 농도값 기록, 음성/실패 시 이전 농도값 클리어
      var isPositive = (result === "positive" || result === "양성");
      sheet.getRange(targetRow, 6).setValue(isPositive ? ((value !== "" && value !== null && value !== undefined) ? value : "0.01") : "");
      sheet.getRange(targetRow, 7).setValue(errorMsg || "");
      if (data.Memo !== undefined || data.memo !== undefined) {
        sheet.getRange(targetRow, 8).setValue(memo);
      }
      
      // 새로 드라이브에 이미지가 올라갔다면 하이퍼링크 갱신
      if (isDriveSuccess && driveFileUrl) {
        var cropCell = sheet.getRange(targetRow, 9);
        var formula = '=HYPERLINK("' + driveFileUrl + '", "' + rawFilename + '")';
        cropCell.setFormula(formula);
      }
    } else {
      // [신규 행 추가]
      var isPos = (result === "positive" || result === "양성");
      var valToSave = isPos ? ((value !== "" && value !== null && value !== undefined) ? value : "0.01") : "";
      var newRow = [
        timestamp,
        userId,
        cLine || "ok",
        tLine || "none",
        result || "negative",
        valToSave,
        errorMsg || "",
        memo || "",
        rawFilename
      ];
      sheet.appendRow(newRow);
      var newLastRowIdx = sheet.getLastRow();

      if (isDriveSuccess && driveFileUrl) {
        var cropCell = sheet.getRange(newLastRowIdx, 9);
        var formula = '=HYPERLINK("' + driveFileUrl + '", "' + rawFilename + '")';
        cropCell.setFormula(formula);
      }
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: isUpdated ? ("Updated row " + targetRow) : "Appended new row",
      isUpdated: isUpdated,
      rowNumber: isUpdated ? targetRow : sheet.getLastRow(),
      timestamp: timestamp,
      driveFileUrl: driveFileUrl,
      driveFileId: driveFileId,
      filename: rawFilename,
      isDriveSuccess: isDriveSuccess,
      errorMsg: errorMsg
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "";
  var targetUser = (e && e.parameter && e.parameter.userId) || "";
  var fileIdParam = (e && e.parameter && e.parameter.fileId) || "";

  // 1. 단일 드라이브 이미지 Base64 가져오기 (CORS 우회)
  if (action === "getImage" && fileIdParam) {
    try {
      var file = DriveApp.getFileById(fileIdParam);
      var blob = file.getBlob();
      var b64 = Utilities.base64Encode(blob.getBytes());
      var contentType = blob.getContentType() || "image/jpeg";
      var dataUrl = "data:" + contentType + ";base64," + b64;

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        fileId: fileIdParam,
        dataUrl: dataUrl
      })).setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "error",
        message: err.toString()
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  // 2. 전체 기록 조회 (Fetch History)
  if (action === "fetch" || action === "getHistory") {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = getMainSheet(ss);
      var lastRow = sheet.getLastRow();
      var results = [];

      if (lastRow > 1) {
        var range = sheet.getRange(2, 1, lastRow - 1, 9);
        var rangeData = range.getValues();
        var rangeFormulas = sheet.getRange(2, 9, lastRow - 1, 1).getFormulas();
        var rangeRichText = sheet.getRange(2, 9, lastRow - 1, 1).getRichTextValues(); // RichText 링크 추출

        var folder = null;
        try {
          if (DRIVE_FOLDER_ID) folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
        } catch (_) {}

        for (var i = 0; i < rangeData.length; i++) {
          var row = rangeData[i];
          var rawTs     = row[0];
          var userId    = String(row[1] || "").trim();
          var cLine     = String(row[2] || "").trim();
          var tLine     = String(row[3] || "").trim();
          var resultRaw = String(row[4] || "").trim();
          var valRaw    = row[5];
          var errStr    = String(row[6] || "").trim();
          var memoStr   = String(row[7] || "").trim();
          var cropVal   = String(row[8] || "").trim();
          var cropForm  = String((rangeFormulas[i] && rangeFormulas[i][0]) || "").trim();
          var richText  = rangeRichText[i] && rangeRichText[i][0];

          // 특정 userId 필터링 (파라미터가 있는 경우)
          if (targetUser && userId && userId !== targetUser) {
            continue;
          }

          // 날짜 포맷 표준화 (초 단위 포함)
          var tsFormatted = "";
          if (rawTs instanceof Date) {
            tsFormatted = Utilities.formatDate(rawTs, "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
          } else {
            var rawStr = String(rawTs || "").trim();
            if (rawStr.length === 16) {
              tsFormatted = rawStr + ":00";
            } else {
              tsFormatted = rawStr.slice(0, 19);
            }
          }

          // 결과 한글화 매핑
          var resultKorean = "실패";
          if (resultRaw === "positive" || resultRaw === "양성") resultKorean = "양성";
          else if (resultRaw === "negative" || resultRaw === "음성") resultKorean = "음성";

          // 농도값 문자열
          var concStr = "-";
          if (resultKorean === "양성") {
            concStr = (valRaw !== "" && valRaw !== null && valRaw !== undefined && valRaw !== "-") ? String(valRaw) : "0.01";
          }

          // ── 이미지 URL 및 Drive File ID 다중 추출 ──
          var cropUrl = "";
          var driveFileId = "";
          var cropName = cropVal;

          // 1) RichText 셀 링크 추출 (가장 최신 Google Sheets 링크 포맷)
          if (richText) {
            var rtLink = richText.getLinkUrl();
            if (rtLink) cropUrl = rtLink;
          }

          // 2) 수식에서 추출: =HYPERLINK("URL", "FILENAME")
          if (!cropUrl && cropForm) {
            var m1 = cropForm.match(/HYPERLINK\s*\(\s*["']([^"']+)["']\s*(?:,\s*["']([^"']+)["'])?\s*\)/i);
            if (m1) {
              cropUrl = m1[1];
              if (m1[2]) cropName = m1[2];
            }
          }

          // 3) 텍스트 값 자체에 URL이 있는 경우
          if (!cropUrl && cropVal.indexOf("http") > -1) {
            cropUrl = cropVal;
          }

          // 4) URL에서 순수 file ID 추출 (25자 이상 영문숫자)
          if (cropUrl) {
            var idMatch = cropUrl.match(/[-\w]{25,}/);
            if (idMatch) driveFileId = idMatch[0];
          }

          // 5) [중요] 드라이브 폴더에서 파일명으로 직접 파일 검색 (Fallback)
          if (!driveFileId && folder && cropName && cropName.indexOf(".jpg") > -1) {
            try {
              var files = folder.getFilesByName(cropName);
              if (files.hasNext()) {
                var f = files.next();
                driveFileId = f.getId();
                cropUrl = f.getUrl();
              }
            } catch (_) {}
          }

          results.push({
            id: "REC_SHEET_" + (i + 1),
            rowIndex: i + 2,
            timestamp: tsFormatted,
            userNickname: userId,
            cLine: cLine,
            tLine: tLine,
            result: resultKorean,
            resultEnglish: resultRaw,
            concentrationStr: concStr,
            error: errStr,
            memo: memoStr,
            cropImageDataUrl: null,
            cropUrl: cropUrl || null,
            driveFileId: driveFileId || null,
            cropFilename: cropName || (userId + "_" + tsFormatted.replace(/[- :]/g, "") + ".jpg")
          });
        }
      }

      // 최신 검사일시가 맨 위로 오도록 내림차순 정렬
      results.sort(function(a, b) {
        var parseDate = function(str) {
          if (!str) return 0;
          var m = String(str).match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})[\sT](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
          if (m) {
            return new Date(parseInt(m[1],10), parseInt(m[2],10)-1, parseInt(m[3],10), parseInt(m[4],10), parseInt(m[5],10), parseInt(m[6] || 0, 10)).getTime();
          }
          var d = new Date(String(str).replace(/\./g, "-"));
          return !isNaN(d.getTime()) ? d.getTime() : 0;
        };
        return parseDate(b.timestamp) - parseDate(a.timestamp);
      });

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        total: results.length,
        data: results
      })).setMimeType(ContentService.MimeType.JSON);

    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "error",
        message: err.toString()
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  // 3. 기본 상태 응답
  return ContentService.createTextOutput(JSON.stringify({
    status: "online",
    message: "YLS LFA Kit API v4.5.1 is running",
    driveFolderId: DRIVE_FOLDER_ID,
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * [편의 도구] 기존 스프레드시트에 쌓인 중복 행 일괄 정리 함수
 * 스프레드시트 상단 함수 목록에서 'cleanupDuplicateRows' 선택 후 [실행]을 누르면,
 * timestamp + User_ID가 동일한 중복 행들 중 가장 최근 행(메모나 수정사항이 반영된 마지막 행)만 남기고
 * 이전 중복 행들을 자동으로 삭제합니다.
 */
function cleanupDuplicateRows() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getMainSheet(ss);
  var lastRow = sheet.getLastRow();
  if (lastRow <= 2) {
    Logger.log("정리할 데이터가 없습니다.");
    return;
  }

  var range = sheet.getRange(2, 1, lastRow - 1, 9);
  var values = range.getDisplayValues();
  var seenKeys = {};
  var rowsToDelete = [];

  // 역순으로 순회 (맨 아래에 있는 최신 행을 유지하고 이전 행을 삭제 대상으로 지정)
  for (var i = values.length - 1; i >= 0; i--) {
    var rowNum = i + 2;
    var ts = (values[i][0] || "").trim().replace(/\s+/g, '');
    var user = (values[i][1] || "").trim();
    var crop = (values[i][8] || "").trim();

    // 식별 키: 타임스탬프와 사용자ID (또는 파일명)
    var key = ts + "__" + user;
    if (crop) key += "__" + crop;

    if (seenKeys[key]) {
      rowsToDelete.push(rowNum);
    } else {
      seenKeys[key] = true;
    }
  }

  // 행 삭제 시 번호가 밀리지 않도록 큰 번호(아래)부터 삭제
  rowsToDelete.sort(function(a, b) { return b - a; });
  for (var j = 0; j < rowsToDelete.length; j++) {
    sheet.deleteRow(rowsToDelete[j]);
  }

  Logger.log("총 " + rowsToDelete.length + "개의 중복 행이 정리되었습니다.");
}

