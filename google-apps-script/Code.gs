/** O Bom Sabor — backend de sincronização (v10, guarda tudo no Google Drive).
 *  1) Troque TOKEN abaixo pelo MESMO token que você já usa no app (ou por uma senha longa nova).
 *  2) Implantar > Gerenciar implantações > lápis (editar) > Versão: Nova versão > Implantar.
 *     (Assim a URL /exec continua a mesma. Autorize o acesso ao Drive quando o Google pedir.)
 *  3) Executar como: você. Quem tem acesso: qualquer pessoa.
 *  Os dados antigos (Script Properties) são copiados sozinhos para o Drive no primeiro uso.
 */
const TOKEN = 'TROQUE-POR-UMA-SENHA-LONGA-E-UNICA';

const ARQ_ESTADO = 'BomSabor_dados.json';
const PASTA_BACKUPS = 'BomSabor_backups';
const MAX_BACKUPS = 20;
const OLD_STATE_KEY = 'BOM_SABOR_CLOUD_V2';
const OLD_HIST_KEY = 'BOM_SABOR_HISTORY_V2';

function doGet() {
  return json_({ok:true, app:'O Bom Sabor Sync', version:3});
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!TOKEN || TOKEN === 'TROQUE-POR-UMA-SENHA-LONGA-E-UNICA') {
      return json_({ok:false, erro:'Configure o TOKEN no Code.gs antes de usar.'});
    }
    if (String(body.token || '') !== String(TOKEN)) {
      return json_({ok:false, erro:'Token inválido.'});
    }

    lock.waitLock(20000); // evita duas gravações ao mesmo tempo
    const props = PropertiesService.getScriptProperties();
    migrarSeNecessario_(props);
    const current = readState_(props);

    if (body.action === 'get') {
      return json_({ok:true, updatedAt:current.updatedAt, data:current.data});
    }

    if (body.action === 'listar_backups') {
      return json_({ok:true, backups:listBackups_(props).map(function(b){
        return {updatedAt:b.updatedAt, dataHora:b.savedAt || b.updatedAt};
      })});
    }

    if (body.action === 'obter_backup') {
      const alvo = Number(body.updatedAt || 0);
      const b = listBackups_(props).find(function(x){ return x.updatedAt === alvo; });
      if (!b) return json_({ok:false, erro:'Backup não encontrado.'});
      const conteudo = JSON.parse(b.file.getBlob().getDataAsString());
      return json_({ok:true, updatedAt:conteudo.updatedAt, data:conteudo.data});
    }

    if (!body.data || typeof body.data !== 'object') {
      return json_({ok:false, erro:'Dados ausentes.'});
    }

    const incomingTs = Number(body.updatedAt || body.data.updatedAt || Date.now());
    if (current.data && Number(current.updatedAt || 0) > incomingTs) {
      return json_({ok:true, status:'kept_remote', updatedAt:current.updatedAt, data:current.data});
    }

    const state = {updatedAt: incomingTs, data: body.data};
    writeState_(props, state);
    saveBackup_(props, state);
    return json_({ok:true, status:'saved', updatedAt:incomingTs});
  } catch (err) {
    return json_({ok:false, erro:String(err && err.message ? err.message : err)});
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ---------- Drive ---------- */

function pastaBackups_(props) {
  const id = props.getProperty('PASTA_BACKUPS_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (_) {} }
  const p = DriveApp.createFolder(PASTA_BACKUPS);
  props.setProperty('PASTA_BACKUPS_ID', p.getId());
  return p;
}

function arquivoEstado_(props) {
  const id = props.getProperty('ARQ_ESTADO_ID');
  if (id) { try { return DriveApp.getFileById(id); } catch (_) {} }
  const f = DriveApp.createFile(ARQ_ESTADO, JSON.stringify({updatedAt:0, data:null}), MimeType.PLAIN_TEXT);
  props.setProperty('ARQ_ESTADO_ID', f.getId());
  return f;
}

function readState_(props) {
  try {
    const s = JSON.parse(arquivoEstado_(props).getBlob().getDataAsString());
    return {updatedAt:Number(s.updatedAt) || 0, data:s.data || null};
  } catch (_) { return {updatedAt:0, data:null}; }
}

function writeState_(props, state) {
  arquivoEstado_(props).setContent(JSON.stringify(state));
}

function saveBackup_(props, state) {
  pastaBackups_(props).createFile(
    'backup_' + state.updatedAt + '.json',
    JSON.stringify({updatedAt:state.updatedAt, savedAt:Date.now(), data:state.data}),
    MimeType.PLAIN_TEXT
  );
  // mantém só os MAX_BACKUPS mais recentes
  listBackups_(props).slice(MAX_BACKUPS).forEach(function(b){ b.file.setTrashed(true); });
}

function listBackups_(props) {
  const out = [];
  const it = pastaBackups_(props).getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const m = /^backup_(\d+)\.json$/.exec(f.getName());
    if (m) out.push({updatedAt:Number(m[1]), savedAt:f.getDateCreated().getTime(), file:f});
  }
  out.sort(function(a, b){ return b.updatedAt - a.updatedAt; });
  return out;
}

/* ---------- Migração dos dados antigos (Script Properties -> Drive) ---------- */

function migrarSeNecessario_(props) {
  if (props.getProperty('MIGRADO_V3')) return;
  try {
    const rawEstado = props.getProperty(OLD_STATE_KEY);
    if (rawEstado && readState_(props).updatedAt === 0) {
      const velho = JSON.parse(rawEstado);
      if (velho && velho.data) writeState_(props, {updatedAt:Number(velho.updatedAt) || Date.now(), data:velho.data});
    }
    const hist = JSON.parse(props.getProperty(OLD_HIST_KEY) || '[]');
    const pasta = pastaBackups_(props);
    hist.forEach(function(h){
      if (!h || !h.updatedAt || !h.data) return;
      pasta.createFile('backup_' + h.updatedAt + '.json',
        JSON.stringify({updatedAt:h.updatedAt, savedAt:h.savedAt || h.updatedAt, data:h.data}), MimeType.PLAIN_TEXT);
    });
    props.setProperty('MIGRADO_V3', '1'); // os dados antigos continuam nas Properties, como segurança
  } catch (_) { /* tenta de novo na próxima chamada */ }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
