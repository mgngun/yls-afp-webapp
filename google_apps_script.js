/**
 * ============================================================================
 * YLS LFA AFP 진단 키트 - Google Apps Script (GAS) 백엔드 코드
 * ============================================================================
 * 
 * [구글 시트 연동 및 웹앱 배포 가이드]
 * 1. 구글 스프레드시트 열기:
 *    https://docs.google.com/spreadsheets/d/1ckyAywMytLJCClUgwizQakq5xdQmm_5fNeQYSW4S3jo/edit
 * 
 * 2. 상단 메뉴에서 [확장 프로그램] -> [Apps Script] 클릭
 * 
 * 3. 기존 코드를 모두 지우고 이 파일의 전체 내용을 복사하여 붙여넣기
 * 
 * 4. 오른쪽 상단의 [배포] -> [새 배포] 클릭
 *    - 유형 선택: [웹 앱] (톱니바퀴 아이콘 클릭 후 '웹 앱' 선택)
 *    - 설명: LFA 결과 수집 API v1
 *    - 다음 사용자로 실행: [나 (내 계정)]
 *    - 액세스 권한이 있는 사용자: [모든 사용자 (Anyone)]  <-- 중요! (로그인 없이 웹앱에서 전송 가능)
 * 
 * 5. [배포] 버튼 클릭 후 권한 승인 진행
 * 
 * 6. 생성된 [웹 앱 URL]:
 *    https://script.google.com/macros/s/AKfycbzyZ_TTNI1Yh9LeGFFR3u2dAW7wAOJUr15HS032lEPDUovWq5syJelMRBbEjV2DthF7/exec
 * 
 * 7. 현재 js/google_sheets.js 코드에 기본 URL로 자동 등록 완료되었습니다.
 * ============================================================================
 */

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
      // 헤더 스타일 적용 (배경색, 굵게)
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
    
    // 데이터 추출 및 매핑
    var timestamp   = data.timestamp || Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
    var userId      = data.User_ID || data.userId || "guest";
    var cLine       = data.C_line || data.cLine || "";
    var tLine       = data.T_line || data.tLine || "";
    var result      = data.result || "";
    var value       = data.value !== undefined ? data.value : "";
    var error       = data.error || "";
    var memo        = data.Memo || data.memo || "";
    var cropImage   = data.Crop_image || data.cropFilename || "";
    
    // 행 추가
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
      message: "Row added successfully",
      timestamp: timestamp
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
  // 웹앱 작동 상태 체크용 GET 엔드포인트
  return ContentService.createTextOutput(JSON.stringify({
    status: "online",
    service: "YLS LFA Diagnostic Google Sheet Sync API",
    time: Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss")
  })).setMimeType(ContentService.MimeType.JSON);
}
