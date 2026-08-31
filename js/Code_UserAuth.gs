/**
 * YLS User Authentication - Google Apps Script
 *
 * Google Spreadsheet에 Users 시트를 만들고 사용자 계정을 저장합니다.
 * 개발 단계용: Password를 평문으로 저장합니다.
 * 실제 서비스 전환 전에는 서버 측 Password 해시 저장으로 교체해야 합니다.
 *
 * 1) 아래 SPREADSHEET_ID를 사용자/검사 결과를 저장할 Google Spreadsheet ID로 변경
 * 2) Apps Script에서 웹 앱으로 배포
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 3) 배포된 /exec URL을 google_user_auth.js의 USER_AUTH_SCRIPT_URL에 입력
 */

const SPREADSHEET_ID = 'https://docs.google.com/spreadsheets/d/1qWB-bRKz-LLgx909dDsm9gbzdHj-ACbVroJXK5BZxhM/edit?gid=0#gid=0';
const USERS_SHEET_NAME = 'Users';

function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = p.action || '';
  const callback = p.callback || '';
  let result;

  try {
    if (action === 'registerUser') {
      result = registerUser_(p.username, p.password);
    } else if (action === 'loginUser') {
      result = loginUser_(p.username, p.password);
    } else if (action === 'changePassword') {
      result = changePassword_(p.username, p.currentPassword, p.newPassword);
    } else if (action === 'health') {
      result = { success: true, message: 'YLS UserAuth OK' };
    } else {
      result = { success: false, message: 'Unknown action.' };
    }
  } catch (err) {
    result = { success: false, message: String(err && err.message ? err.message : err) };
  }

  const json = JSON.stringify(result);

  // 브라우저의 JSONP 로그인/등록 요청을 위한 응답
  if (callback && /^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizeSpreadsheetId_(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.indexOf('PASTE_YOUR_') === 0) {
    throw new Error('SPREADSHEET_ID를 설정하세요.');
  }

  // ID만 입력한 경우
  if (/^[A-Za-z0-9_-]{20,}$/.test(raw)) return raw;

  // Google Sheets 전체 URL을 입력한 경우도 자동으로 ID만 추출
  const match = raw.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (match && match[1]) return match[1];

  throw new Error('올바른 Google Spreadsheet ID 또는 Google Sheets URL이 아닙니다.');
}

function getUsersSheet_() {
  const spreadsheetId = normalizeSpreadsheetId_(SPREADSHEET_ID);
  const ss = SpreadsheetApp.openById(spreadsheetId);
  let sheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(USERS_SHEET_NAME);
    sheet.getRange(1, 1, 1, 3).setValues([['User_ID', 'Password', 'Created_At']]);
  } else if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 3).setValues([['User_ID', 'Password', 'Created_At']]);
  }

  // 기존 기본 계정이 없다면 개발용 계정 생성
  if (sheet.getLastRow() < 2) {
    sheet.getRange(2, 1, 1, 3).setValues([['yelloi', '1111', new Date()]]);
  }
  return sheet;
}

function validateCredentials_(username, password) {
  if (!username || !/^[A-Za-z_]{1,8}$/.test(username)) {
    return 'User_ID는 영문 또는 언더스코어(_) 1~8자만 가능합니다.';
  }
  if (!password || String(password).length < 4) {
    return 'Password는 최소 4자 이상이어야 합니다.';
  }
  return '';
}

function findUserRow_(sheet, username) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const target = String(username || '').trim();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === target) return i + 2;
  }
  return -1;
}

function registerUser_(username, password) {
  username = String(username || '').trim();
  password = String(password || '');

  const validation = validateCredentials_(username, password);
  if (validation) return { success: false, message: validation };

  const sheet = getUsersSheet_();
  if (findUserRow_(sheet, username) !== -1) {
    return { success: false, message: '이미 등록된 User_ID 입니다.' };
  }

  sheet.appendRow([username, password, new Date()]);
  return { success: true, message: '사용자가 등록되었습니다.', username };
}

function loginUser_(username, password) {
  username = String(username || '').trim();
  password = String(password || '');

  const sheet = getUsersSheet_();
  const row = findUserRow_(sheet, username);
  if (row === -1) {
    return { success: false, message: '등록되지 않은 User_ID 입니다.' };
  }

  const storedPassword = String(sheet.getRange(row, 2).getValue());
  if (storedPassword !== password) {
    return { success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' };
  }

  return { success: true, message: '로그인 성공', username };
}

function changePassword_(username, currentPassword, newPassword) {
  username = String(username || '').trim();
  currentPassword = String(currentPassword || '');
  newPassword = String(newPassword || '');

  if (newPassword.length < 4) {
    return { success: false, message: '새 Password는 최소 4자 이상이어야 합니다.' };
  }

  const sheet = getUsersSheet_();
  const row = findUserRow_(sheet, username);
  if (row === -1) return { success: false, message: '현재 사용자 정보를 찾을 수 없습니다.' };

  const storedPassword = String(sheet.getRange(row, 2).getValue());
  if (storedPassword !== currentPassword) {
    return { success: false, message: '현재 Password가 일치하지 않습니다.' };
  }

  sheet.getRange(row, 2).setValue(newPassword);
  return { success: true, message: 'Password가 변경되었습니다.' };
}
