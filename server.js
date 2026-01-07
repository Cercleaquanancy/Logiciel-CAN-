const http = require('http');
const fs = require('fs');
const path = require('path');

// IMPORTANT pour Render : utiliser process.env.PORT
const port = process.env.PORT || 5500;

// Fichier de stockage central
const DATA_FILE = path.join(__dirname, 'data.json');

// Admin "fixe"
const ADMIN_LOGIN = 'can';
const ADMIN_PASS = '29081623';

// Charger les données du fichier
function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return {
        members: [],
        loginHistory: [],
        population: [],
        annonces: [],
        serre: {
          notes: "",
          bacs: [],
          assignments: {},
          feed: {
            lastUpdate: null,
            items: [],
            monthlyUseKg: 0
          }
        }
      };
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);

    const serreParsed = parsed.serre && typeof parsed.serre === 'object' ? parsed.serre : {};

    return {
      members: Array.isArray(parsed.members) ? parsed.members : [],
      loginHistory: Array.isArray(parsed.loginHistory) ? parsed.loginHistory : [],
      population: Array.isArray(parsed.population) ? parsed.population : [],
      annonces: Array.isArray(parsed.annonces) ? parsed.annonces : [],
      serre: {
        notes: typeof serreParsed.notes === 'string' ? serreParsed.notes : "",
        bacs: Array.isArray(serreParsed.bacs) ? serreParsed.bacs : [],
        assignments: serreParsed.assignments && typeof serreParsed.assignments === 'object'
          ? serreParsed.assignments
          : {},
        feed: serreParsed.feed && typeof serreParsed.feed === 'object'
          ? {
              lastUpdate: serreParsed.feed.lastUpdate || null,
              items: Array.isArray(serreParsed.feed.items) ? serreParsed.feed.items : [],
              monthlyUseKg: typeof serreParsed.feed.monthlyUseKg === 'number'
                ? serreParsed.feed.monthlyUseKg
                : 0
            }
          : {
              lastUpdate: null,
              items: [],
              monthlyUseKg: 0
            }
      }
    };
  } catch (e) {
    console.error('Erreur lecture data.json :', e);
    return {
      members: [],
      loginHistory: [],
      population: [],
      annonces: [],
      serre: {
        notes: "",
        bacs: [],
        assignments: {},
        feed: {
          lastUpdate: null,
          items: [],
          monthlyUseKg: 0
        }
      }
    };
  }
}

// Sauvegarder les données dans le fichier
function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Erreur écriture data.json :', e);
  }
}

// Réponse JSON
function sendJson(res, statusCode, obj) {
  const json = JSON.stringify(obj);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(json);
}

// Réponse texte simple
function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(text);
}

// Lire le corps JSON d'une requête POST/PATCH
function parseJsonBody(req, callback) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 1e6) {
      req.connection.destroy();
    }
  });
  req.on('end', () => {
    if (!body) {
      callback(null, {});
      return;
    }
    try {
      const json = JSON.parse(body);
      callback(null, json);
    } catch (e) {
      callback(e);
    }
  });
}

// Serveur HTTP
const server = http.createServer((req, res) => {
  const [pathOnly] = req.url.split('?');
  const url = pathOnly;
  const method = req.method;

  // CORS pré-vol
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // =======================
  //        API MEMBRES
  // =======================

  // GET /api/members : liste des adhérents
  if (method === 'GET' && url === '/api/members') {
    const data = loadData();
    sendJson(res, 200, data.members);
    return;
  }

  // POST /api/members : ajouter / modifier un adhérent
  // body: { login, pass, role, serre }
  if (method === 'POST' && url === '/api/members') {
    parseJsonBody(req, (err, body) => {
      if (err) {
        sendText(res, 400, 'JSON invalide');
        return;
      }
      const { login, pass, role, serre } = body;
      if (!login || !pass) {
        sendText(res, 400, 'login et pass obligatoires');
        return;
      }
      const data = loadData();
      let users = data.members;

      const existingIndex = users.findIndex(u => u.login === login);
      if (existingIndex >= 0) {
        users[existingIndex].pass = pass;
        users[existingIndex].role = role || 'adhérent';
        users[existingIndex].serre = !!serre;
      } else {
        users.push({
          login,
          pass,
          role: role || 'adhérent',
          serre: !!serre
        });
      }
      data.members = users;
      saveData(data);
      sendJson(res, 200, { success: true });
    });
    return;
  }

  // DELETE /api/members/:login
  if (method === 'DELETE' && url.startsWith('/api/members/')) {
    const login = decodeURIComponent(url.replace('/api/members/', ''));
    const data = loadData();
    let users = data.members;
    const before = users.length;
    users = users.filter(u => u.login !== login);
    data.members = users;
    saveData(data);
    sendJson(res, 200, { success: true, removed: before - users.length });
    return;
  }

  // POST /api/login : vérification identifiants
  // body: { username, password }
  if (method === 'POST' && url === '/api/login') {
    parseJsonBody(req, (err, body) => {
      if (err) {
        sendText(res, 400, 'JSON invalide');
        return;
      }
      const { username, password } = body;
      if (!username || !password) {
        sendText(res, 400, 'username et password obligatoires');
        return;
      }

      const data = loadData();

      // Admin fixe
      if (username === ADMIN_LOGIN && password === ADMIN_PASS) {
        const userObj = { username, role: 'admin', serre: true };
        data.loginHistory = data.loginHistory || [];
        data.loginHistory.push({
          username,
          role: 'admin',
          date: new Date().toISOString()
        });
        saveData(data);
        sendJson(res, 200, {
          success: true,
          user: userObj
        });
        return;
      }

      // Adhérent
      const members = data.members || [];
      const found = members.find(m => m.login === username);
      if (!found) {
        sendJson(res, 401, { success: false, error: 'unknown_user' });
        return;
      }
      if (found.pass !== password) {
        sendJson(res, 401, { success: false, error: 'bad_password' });
        return;
      }

      const role = found.role || 'adhérent';
      const serre = !!found.serre;
      const userObj = { username, role, serre };

      data.loginHistory = data.loginHistory || [];
      data.loginHistory.push({
        username,
        role,
        date: new Date().toISOString()
      });
      saveData(data);

      sendJson(res, 200, {
        success: true,
        user: userObj
      });
    });
    return;
  }

  // GET /api/history : récupère l'historique
  if (method === 'GET' && url === '/api/history') {
    const data = loadData();
    sendJson(res, 200, data.loginHistory || []);
    return;
  }

  // POST /api/history/clear : vider l'historique
  if (method === 'POST' && url === '/api/history/clear') {
    const data = loadData();
    data.loginHistory = [];
    saveData(data);
    sendJson(res, 200, { success: true });
    return;
  }

  // POST /api/members/clear : vider tous les adhérents
  if (method === 'POST' && url === '/api/members/clear') {
    const data = loadData();
    data.members = [];
    saveData(data);
    sendJson(res, 200, { success: true });
    return;
  }

  // =======================
  //        API POPULATION
  // =======================

  // GET /api/population
  if (method === 'GET' && url === '/api/population') {
    const data = loadData();
    const population = Array.isArray(data.population) ? data.population : [];
    sendJson(res, 200, population);
    return;
  }

  // POST /api/population/sync
  if (method === 'POST' && url === '/api/population/sync') {
    parseJsonBody(req, (err, body) => {
      if (err) {
        sendText(res, 400, 'JSON invalide');
        return;
      }

      const { memberUsername, entries } = body || {};
      if (!memberUsername || !Array.isArray(entries)) {
        sendText(res, 400, 'memberUsername et entries (tableau) sont obligatoires');
        return;
      }

      const data = loadData();
      const currentPop = Array.isArray(data.population) ? data.population : [];

      const filtered = currentPop.filter(e => e.memberUsername !== memberUsername);

      const newEntries = entries
        .filter(e => e && e.speciesName)
        .map(e => ({
          memberUsername,
          speciesName: String(e.speciesName),
          source: e.source ? String(e.source) : '',
          totalCount: Number(e.totalCount) > 0 ? Number(e.totalCount) : 0
        }));

      data.population = filtered.concat(newEntries);
      saveData(data);

      sendJson(res, 200, { success: true, count: newEntries.length });
    });
    return;
  }

  // =======================
  //        API ANNONCES
  // =======================

  // GET /api/annonces
  if (method === 'GET' && url === '/api/annonces') {
    const data = loadData();
    const annonces = Array.isArray(data.annonces) ? data.annonces : [];
    sendJson(res, 200, annonces);
    return;
  }

  // POST /api/annonces  (créer une annonce)
  // body: { titre, type, description, categorie, auteur }
  if (method === 'POST' && url === '/api/annonces') {
    parseJsonBody(req, (err, body) => {
      if (err) {
        sendText(res, 400, 'JSON invalide');
        return;
      }
      const { titre, type, description, categorie, auteur } = body || {};
      if (!titre || !type || !categorie || !auteur) {
        sendText(res, 400, 'titre, type, categorie et auteur sont obligatoires');
        return;
      }

      const data = loadData();
      const annonces = Array.isArray(data.annonces) ? data.annonces : [];

      const id = "annonce_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
      const annonce = {
        id,
        titre: String(titre).trim(),
        type: String(type),
        description: (description || '').toString().trim(),
        auteur: String(auteur),
        prive: true,
        categorie: String(categorie),
        favoriPar: []
      };

      annonces.push(annonce);
      data.annonces = annonces;
      saveData(data);

      sendJson(res, 200, { success: true, annonce });
    });
    return;
  }

  // PATCH /api/annonces/:id/togglePrivate
  if (method === 'PATCH' && url.startsWith('/api/annonces/') && url.endsWith('/togglePrivate')) {
    const id = decodeURIComponent(url.replace('/api/annonces/', '').replace('/togglePrivate', ''));
    parseJsonBody(req, (err, body) => {
      if (err) {
        sendText(res, 400, 'JSON invalide');
        return;
      }
      const { username } = body || {};
      if (!username) {
        sendText(res, 400, 'username obligatoire');
        return;
      }

      const data = loadData();
      const annonces = Array.isArray(data.annonces) ? data.annonces : [];
      const a = annonces.find(x => x.id === id);
      if (!a) {
        sendText(res, 404, 'Annonce introuvable');
        return;
      }

      if (a.auteur !== username) {
        sendText(res, 403, 'Non autorisé');
        return;
      }

      a.prive = !a.prive;
      saveData(data);
      sendJson(res, 200, { success: true, annonce: a });
    });
    return;
  }

  // PATCH /api/annonces/:id/toggleFavori
  if (method === 'PATCH' && url.startsWith('/api/annonces/') && url.endsWith('/toggleFavori')) {
    const id = decodeURIComponent(url.replace('/api/annonces/', '').replace('/toggleFavori', ''));
    parseJsonBody(req, (err, body) => {
      if (err) {
        sendText(res, 400, 'JSON invalide');
        return;
      }
      const { username } = body || {};
      if (!username) {
        sendText(res, 400, 'username obligatoire');
        return;
      }

      const data = loadData();
      const annonces = Array.isArray(data.annonces) ? data.annonces : [];
      const a = annonces.find(x => x.id === id);
      if (!a) {
        sendText(res, 404, 'Annonce introuvable');
        return;
      }

      if (!Array.isArray(a.favoriPar)) a.favoriPar = [];
      const idx = a.favoriPar.indexOf(username);
      if (idx === -1) a.favoriPar.push(username);
      else a.favoriPar.splice(idx, 1);

      saveData(data);
      sendJson(res, 200, { success: true, annonce: a });
    });
    return;
  }

  // DELETE /api/annonces/:id
  if (method === 'DELETE' && url.startsWith('/api/annonces/')) {
    const id = decodeURIComponent(url.replace('/api/annonces/', ''));
    parseJsonBody(req, (err, body) => {
      const { username, role } = body || {};
      if (!username) {
        sendText(res, 400, 'username obligatoire');
        return;
      }

      const data = loadData();
      const annonces = Array.isArray(data.annonces) ? data.annonces : [];
      const a = annonces.find(x => x.id === id);
      if (!a) {
        sendText(res, 404, 'Annonce introuvable');
        return;
      }

      const isOwner = a.auteur === username;
      const isAdminLike = role === 'admin' || role === 'membre_bureau';
      if (!isOwner && !isAdminLike) {
        sendText(res, 403, 'Non autorisé');
        return;
      }

      const restantes = annonces.filter(x => x.id !== id);
      data.annonces = restantes;
      saveData(data);

      sendJson(res, 200, { success: true });
    });
    return;
  }

  // =======================
  //        API SERRE
  // =======================

  // GET /api/serre : récupérer notes, bacs, assignments, feed
  if (method === 'GET' && url === '/api/serre') {
    const data = loadData();
    const serre = data.serre || {
      notes: "",
      bacs: [],
      assignments: {},
      feed: {
        lastUpdate: null,
        items: [],
        monthlyUseKg: 0
      }
    };
    sendJson(res, 200, {
      notes: typeof serre.notes === 'string' ? serre.notes : "",
      bacs: Array.isArray(serre.bacs) ? serre.bacs : [],
      assignments: serre.assignments && typeof serre.assignments === 'object'
        ? serre.assignments
        : {},
      feed: serre.feed && typeof serre.feed === 'object'
        ? serre.feed
        : {
            lastUpdate: null,
            items: [],
            monthlyUseKg: 0
          }
    });
    return;
  }

  // POST /api/serre/notes : sauvegarder les notes générales
  // body: { notes }
  if (method === 'POST' && url === '/api/serre/notes') {
    parseJsonBody(req, (err, body) => {
      if (err) {
        sendText(res, 400, 'JSON invalide');
        return;
      }
      const { notes } = body || {};
      const data = loadData();
      if (!data.serre || typeof data.serre !== 'object') {
        data.serre = {
          notes: "",
          bacs: [],
          assignments: {},
          feed: {
            lastUpdate: null,
            items: [],
            monthlyUseKg: 0
          }
        };
      }
      data.serre.notes = typeof notes === 'string' ? notes : "";
      saveData(data);
      sendJson(res, 200, { success: true });
    });
    return;
  }

  // POST /api/serre/bacs : sauvegarder la liste de bacs et les assignments
  // body: { bacs, assignments }
  if (method === 'POST' && url === '/api/serre/bacs') {
    parseJsonBody(req, (err, body) => {
      if (err) {
        sendText(res, 400, 'JSON invalide');
        return;
      }
      const { bacs, assignments } = body || {};
      if (!Array.isArray(bacs)) {
        sendText(res, 400, 'bacs doit être un tableau');
        return;
      }

      const cleanedBacs = bacs.map(b => ({
        id: b.id,
        name: String(b.name || "Bac serre"),
        lastWaterChange: b.lastWaterChange || null,
        lastFilterClean: b.lastFilterClean || null
      }));

      const assignObj =
        assignments && typeof assignments === 'object' ? assignments : {};

      const data = loadData();
      if (!data.serre || typeof data.serre !== 'object') {
        data.serre = {
          notes: "",
          bacs: [],
          assignments: {},
          feed: {
            lastUpdate: null,
            items: [],
            monthlyUseKg: 0
          }
        };
      }
      data.serre.bacs = cleanedBacs;
      data.serre.assignments = assignObj;
      saveData(data);

      sendJson(res, 200, { success: true });
    });
    return;
  }

  // POST /api/serre/feed : sauvegarder les stocks de nourriture
  // body: { items, monthlyUseKg }
  if (method === 'POST' && url === '/api/serre/feed') {
    parseJsonBody(req, (err, body) => {
      if (err) {
        sendText(res, 400, 'JSON invalide');
        return;
      }
      const { items, monthlyUseKg } = body || {};

      const cleanItems = Array.isArray(items)
        ? items.map((it, idx) => ({
            id: it.id || ("feed_" + Date.now() + "_" + idx),
            name: String(it.name || ""),
            unit: String(it.unit || "kg"),
            quantity: Number(it.quantity) || 0
          }))
        : [];

      const mUse = Number(monthlyUseKg);
      const data = loadData();
      if (!data.serre || typeof data.serre !== 'object') {
        data.serre = {
          notes: "",
          bacs: [],
          assignments: {},
          feed: {
            lastUpdate: null,
            items: [],
            monthlyUseKg: 0
          }
        };
      }
      data.serre.feed = {
        lastUpdate: new Date().toISOString(),
        items: cleanItems,
        monthlyUseKg: isNaN(mUse) ? 0 : mUse
      };
      saveData(data);

      sendJson(res, 200, { success: true });
    });
    return;
  }

  // =======================
  //   SERVEUR DE FICHIERS
  // =======================

  let filePath = url;

  if (filePath === '/' || filePath === '/index' || filePath === '/index.html') {
    filePath = '/index.html';
  }

  filePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
  const fullPath = path.join(__dirname, filePath);

  const extname = String(path.extname(fullPath)).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };
  const contentType = mimeTypes[extname] || 'text/html';

  fs.readFile(fullPath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Fichier non trouvé');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Erreur serveur');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(port, () => {
  console.log(`Serveur Node lancé sur http://localhost:${port}/`);
});
