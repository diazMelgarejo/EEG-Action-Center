/**
 * Read-only audit of Hardware changes column C. Standalone script: paste it into a NEW project at script.google.com,
 * set SPREADSHEET_ID, set the manifest scope below, run auditDateTimeColumn, read the Execution log. It never writes.
 *
 * appsscript.json for this project:
 *   { "timeZone": "Etc/UTC", "runtimeVersion": "V8",
 *     "oauthScopes": ["https://www.googleapis.com/auth/spreadsheets.readonly"] }
 */
const SPREADSHEET_ID = 'paste the id from the sheet link';
const FIRST_DATA_ROW = 4;
const STANDARD_R1C1 = '=SUM(R[0]C[-2]:R[0]C[-1])';

function auditDateTimeColumn() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Hardware changes');
  const count = sheet.getLastRow() - FIRST_DATA_ROW + 1;
  const range = sheet.getRange(FIRST_DATA_ROW, 1, count, 7);
  const values = range.getValues();
  const formulas = range.getFormulasR1C1();
  const found = { standard: [], otherFormula: [], typed: [], blankWithInputs: [], noTime: [], noDate: [] };
  values.forEach((row, index) => {
    const rowNumber = FIRST_DATA_ROW + index;
    if (row.slice(0, 7).every((cell) => cell === '')) return;
    const [date, time, combined] = row;
    const formula = formulas[index][2];
    if (formula === STANDARD_R1C1) found.standard.push(rowNumber);
    else if (formula) found.otherFormula.push(`${rowNumber}: ${formula}`);
    else if (combined !== '') found.typed.push(rowNumber);
    else if (date !== '' && time !== '') found.blankWithInputs.push(rowNumber);
    if (formula && time === '') found.noTime.push(rowNumber);
    if (formula && date === '') found.noDate.push(rowNumber);
  });
  Object.keys(found).forEach((key) => {
    console.info(`${key}: ${found[key].length}${key === 'standard' ? '' : ` ${found[key].slice(0, 40).join(', ')}`}`);
  });
}
