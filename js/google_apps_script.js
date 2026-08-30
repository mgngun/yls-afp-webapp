/**
 * ============================================================================
 * YLS LFA AFP 진단 키트 - Google Apps Script (GAS) 백엔드 코드
 * 구글 시트 저장 + 구글 드라이브 이미지 자동 업로드 연동
 * ============================================================================
 * 
 * [설정된 구글 리소스]
 * 1. 스프레드시트: https://docs.google.com/spreadsheets/d/1ckyAywMytLJCClUgwizQakq5xdQmm_5fNeQYSW4S3jo/edit
 * 2. 이미지 저장 드라이브 폴더: https://drive.google.com/drive/u/0/folders/1U-3jUSs7tutgovrNeOZE7P5Y_KuBqlwI
 *    - 폴더 ID: 1U-3jUSs7tutgovrNeOZE7P5Y_KuBqlwI
 * 
 * [배포 및 업데이트 방법]
 * 1. 구글 스프레드시트 상단 [확장 프로그램] -> [Apps Script] 클릭
 * 2. 기존 코드를 모두 지우고 이 파일의 전체 내용을 붙여넣기
 * 3. 오른쪽 상단 [배포] -> [배포 관리] 클릭
 * 4. [수정(연필 아이콘)] 클릭 -> 버전: [새 버전] 선택 -> [배포] 클릭
 *    - (최초 배포인 경우: [배포] -> [새 배포] -> 유형: [웹 앱] -> 액세스 권한: [모든 사용자(Anyone)])
 * 5. 권한 확인 팝업이 뜨면 [고급] -> [안전하지 않음(으)로 이동] -> [허용] 클릭
 * ============================================================================
 */

// 이미지 저장 대상 구글 드라이브 폴더 ID
var DRIVE_FOLDER_ID = "1U-3jUSs7tutgovrNeOZE7P5Y_KuBqlwI";

function doPost(e) {
  var lock = LockService.getScriptLock();
  // 동시 요청 충돌 방지를 위해 최대 30초 대기
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
    
    // 1. 데이터 추출
    var timestamp   = data.timestamp || Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
    var userId      = data.User_ID || data.userId || "guest";
    var cLine       = data.C_line || data.cLine || "";
    var tLine       = data.T_line || data.tLine || "";
    var result      = data.result || "";
    var value       = data.value !== undefined ? data.value : "";
    var error       = data.error || "";
    var memo        = data.Memo || data.memo || "";
    var cropImage   = data.Crop_image || data.cropFilename || "";
    
    // 2. 구글 드라이브에 이미지 파일 저장 (Base64가 전달된 경우)
    var imageBase64 = data.crop_image_base64 || data.cropImageBase64 || data.imageBase64 || "";
    var driveFileUrl = "";
    var driveFileId  = "";
    
    if (imageBase64 && DRIVE_FOLDER_ID) {
      try {
        var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
        
        // Data URL 헤더 제거 (data:image/jpeg;base64, 부분)
        var pureBase64 = imageBase64;
        if (pureBase64.indexOf("base64,") > -1) {
          pureBase64 = pureBase64.split("base64,")[1];
        }
        
        var decodedBytes = Utilities.base64Decode(pureBase64);
        var filename = cropImage || (userId + "_" + Utilities.formatDate(new Date(), "Asia/Seoul", "yyyyMMddHHmmss") + ".jpg");
        if (filename.indexOf(".jpg") === -1 && filename.indexOf(".png") === -1) {
          filename += ".jpg";
        }
        
        var blob = Utilities.newBlob(decodedBytes, "image/jpeg", filename);
        var file = folder.createFile(blob);
        
        // 링크가 있는 모든 사용자가 볼 수 있도록 공개 권한 설정
        try {
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        } catch (_) {}
        
        driveFileId  = file.getId();
        driveFileUrl = file.getUrl();
        
        // 시트의 Crop_image 열에 구글 드라이브 파일 URL 저장
        cropImage = driveFileUrl;
      } catch (driveErr) {
        Logger.log("Drive save error: " + driveErr.toString());
        // 드라이브 저장 실패 시 기존 파일명 유지
      }
    }
    
    // 3. 스프레드시트에 행 추가
    sheet.appendRow([
      timestamp,
      userId,
      cLine,
      tLine,
      result,
      value,
      error,
      memo,
      cropImage
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "Data and image processed successfully",
      timestamp: timestamp,
      driveFileUrl: driveFileUrl,
      driveFileId: driveFileId,
      cropImage: cropImage
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
  return ContentService.createTextOutput(JSON.stringify({
    status: "online",
    message: "YLS LFA Kit Google Apps Script API is running",
    driveFolderId: DRIVE_FOLDER_ID,
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}
