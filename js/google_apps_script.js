/**
 * ============================================================================
 * YLS LFA AFP 진단 키트 - Google Apps Script (GAS) 백엔드 코드
 * 구글 시트 저장 + 구글 드라이브 이미지 자동 업로드 연동 (v4.3.2)
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
 * 이 함수는 구글 권한 승인 창을 강제로 띄우기 위한 함수입니다.
 * 툴바에서 'authorizeDriveApp'을 선택하고 [실행]을 누르면 즉시 구글 계정 권한 승인 창이 뜹니다.
 */
function authorizeDriveApp() {
  // DriveApp 및 SpreadsheetApp을 직접 호출하여 강제로 권한 팝업을 발생시킴
  var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  var file = folder.createFile("auth_test.txt", "OK");
  file.setTrashed(true);
  SpreadsheetApp.getActiveSpreadsheet();
  Logger.log("🎉 구글 드라이브 및 스프레드시트 권한 승인이 성공적으로 완료되었습니다!");
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(30000);
  
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    
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
    
    // 1. 기본 필드 추출
    var timestamp   = data.timestamp || Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
    var userId      = data.User_ID || data.userId || "guest";
    var cLine       = data.C_line || data.cLine || "";
    var tLine       = data.T_line || data.tLine || "";
    var result      = data.result || "";
    var value       = data.value !== undefined ? data.value : "";
    var errorMsg    = data.error || "";
    var memo        = data.Memo || data.memo || "";
    var rawFilename = data.crop_filename || data.Crop_image || data.cropFilename || (userId + "_" + Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMddHHmmss") + ".jpg");
    
    if (rawFilename.indexOf(".jpg") === -1 && rawFilename.indexOf(".png") === -1) {
      rawFilename += ".jpg";
    }

    // 2. 구글 드라이브에 이미지 파일 저장
    var imageBase64 = data.crop_image_base64 || data.cropImageBase64 || data.imageBase64 || "";
    var driveFileUrl   = "";
    var driveFileId    = "";
    var isDriveSuccess = false;
    
    if (imageBase64 && DRIVE_FOLDER_ID) {
      try {
        var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
        
        // Data URL 헤더(data:image/jpeg;base64,) 제거
        var pureBase64 = imageBase64;
        if (pureBase64.indexOf("base64,") > -1) {
          pureBase64 = pureBase64.split("base64,")[1];
        }
        
        var decodedBytes = Utilities.base64Decode(pureBase64);
        var blob = Utilities.newBlob(decodedBytes, "image/jpeg", rawFilename);
        var file = folder.createFile(blob);
        
        // 누구나 링크로 볼 수 있도록 권한 설정
        try {
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (_) {}
        
        driveFileId    = file.getId();
        driveFileUrl   = "https://drive.google.com/file/d/" + driveFileId + "/view";
        isDriveSuccess = true;
      } catch (driveErr) {
        errorMsg = (errorMsg ? errorMsg + " | " : "") + "DriveErr: " + driveErr.toString();
      }
    } else if (!imageBase64) {
      errorMsg = (errorMsg ? errorMsg + " | " : "") + "NoImageBase64Received";
    }
    
    // 3. 스프레드시트에 행 추가
    var newRow = [
      timestamp,
      userId,
      cLine,
      tLine,
      result,
      value,
      errorMsg,
      memo,
      rawFilename
    ];
    sheet.appendRow(newRow);
    var lastRowIdx = sheet.getLastRow();

    // 4. 구글 드라이브 업로드 성공 시 HYPERLINK 수식 직접 셀에 주입 (파란색 클릭 가능한 링크)
    if (isDriveSuccess && driveFileUrl) {
      var cropCell = sheet.getRange(lastRowIdx, 9);
      var formula = '=HYPERLINK("' + driveFileUrl + '", "' + rawFilename + '")';
      cropCell.setFormula(formula);
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "Processed",
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
      var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
      var lastRow = sheet.getLastRow();
      var results = [];

      if (lastRow > 1) {
        // 헤더 제외 2행부터 전체 데이터 읽기 (1~9열)
        var rangeData = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
        var rangeFormulas = sheet.getRange(2, 9, lastRow - 1, 1).getFormulas();

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

          // 특정 userId 필터링 (파라미터가 있는 경우)
          if (targetUser && userId && userId !== targetUser) {
            continue;
          }

          // 날짜 포맷 표준화
          var tsFormatted = "";
          if (rawTs instanceof Date) {
            tsFormatted = Utilities.formatDate(rawTs, "Asia/Seoul", "yyyy-MM-dd HH:mm");
          } else {
            tsFormatted = String(rawTs || "").slice(0, 16);
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

          // 이미지 URL, File ID 및 파일명 추출
          var cropUrl = "";
          var driveFileId = "";
          var cropName = cropVal;

          if (cropForm && cropForm.indexOf("HYPERLINK") > -1) {
            var match = cropForm.match(/HYPERLINK\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/i);
            if (match) {
              cropUrl = match[1];
              cropName = match[2];
            }
          } else if (cropVal.indexOf("http") === 0) {
            cropUrl = cropVal;
          }

          if (cropUrl) {
            var idMatch = cropUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || cropUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
            if (idMatch) driveFileId = idMatch[1];
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
            cropImageDataUrl: null, // 프론트엔드에서 fileId로 필요할 때 즉시 로드
            cropUrl: cropUrl || null,
            driveFileId: driveFileId || null,
            cropFilename: cropName || null
          });
        }
      }

      // 최신 검사가 맨 위로 오도록 내림차순 정렬 (역순)
      results.reverse();

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
    message: "YLS LFA Kit API v4.4.1 is running",
    driveFolderId: DRIVE_FOLDER_ID,
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}
