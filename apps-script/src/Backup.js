/**
 * Backup semanal da planilha do banco: toda segunda, entre 3h e 4h, uma cópia vai para a
 * pasta "JV Imports - Backups" no Drive. Ficam as 8 cópias mais recentes.
 * Para ligar: rode ativarBackupSemanal() uma vez pelo editor.
 */
const PASTA_BACKUP = 'JV Imports - Backups';
const BACKUPS_MANTIDOS = 8;

function ativarBackupSemanal() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'fazerBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('fazerBackup').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(3).create();
  fazerBackup();
  Logger.log('Backup semanal ligado. Primeira cópia feita na pasta "' + PASTA_BACKUP + '".');
}

function fazerBackup() {
  const original = DriveApp.getFileById(planilha_().getId());
  const pastas = DriveApp.getFoldersByName(PASTA_BACKUP);
  const pasta = pastas.hasNext() ? pastas.next() : DriveApp.createFolder(PASTA_BACKUP);
  const nome = NOME_PLANILHA + ' - backup ' + Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd HH:mm');
  original.makeCopy(nome, pasta);

  const copias = [];
  const arquivos = pasta.getFiles();
  while (arquivos.hasNext()) copias.push(arquivos.next());
  copias.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  copias.slice(BACKUPS_MANTIDOS).forEach(function (f) { f.setTrashed(true); });
}
