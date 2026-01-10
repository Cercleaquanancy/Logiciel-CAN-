const http = require('http');
const fs = require('fs');
const path = require('path');
const pool = require('./db'); // connexion Neon

// IMPORTANT pour Render : utiliser process.env.PORT
const port = process.env.PORT || 5500;

// Fichier de stockage (pour loginHistory, serre, etc.)
const DATA_FILE = path.join(__dirname, 'data.json');

// Admin "fixe"
const ADMIN_LOGIN = 'can';
const ADMIN_PASS = '29081623';

// Charger les données du fichier (reste)
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

// Sauvegarder les données dans le fichier (reste)
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

// Lire le corps JSON
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
  //        API MEMBRES (Neon)
  // =======================

  // GET /api/members
  if (method === 'GET' && url === '/api/members') {
    pool.query('SELECT login, pass, role, serre FROM members ORDER BY login ASC')
      .then(result => {
        sendJson(res, 200, result.rows);
      })
      .catch(err => {
        console.error('Erreur SELECT members :', err);
        sendText(res, 500, 'Erreur serveur');
      });
    return;
  }

  // POST /api/members
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

      const finalRole = role || 'adhérent';
      const serreBool = !!serre;

      const query = `
        INSERT INTO members (login, pass, role, serre)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (login)
        DO UPDATE SET pass = EXCLUDED.pass,
                      role = EXCLUDED.role,
                      serre = EXCLUDED.serre
      `;
      const params = [login, pass, finalRole, serreBool];

      pool.query(query, params)
        .then(() => {
          sendJson(res, 200, { success: true });
        })
        .catch(dbErr => {
          console.error('Erreur INSERT/UPDATE member :', dbErr);
          sendText(res, 500, 'Erreur serveur');
        });
    });
    return;
  }

  // DELETE /api/members/:login
  if (method === 'DELETE' && url.startsWith('/api/members/')) {
    const login = decodeURIComponent(url.replace('/api/members/', ''));

    pool.query('DELETE FROM members WHERE login = $1', [login])
      .then(result => {
        sendJson(res, 200, { success: true, removed: result.rowCount });
      })
      .catch(err => {
        console.error('Erreur DELETE member :', err);
        sendText(res, 500, 'Erreur serveur');
      });
    return;
  }

  // POST /api/members/clear
  if (method === 'POST' && url === '/api/members/clear') {
    pool.query('DELETE FROM members')
      .then(() => {
        sendJson(res, 200, { success: true });
      })
      .catch(err => {
        console.error('Erreur DELETE ALL members :', err);
        sendText(res, 500, 'Erreur serveur');
      });
    return;
  }

  // =======================
  //        API LOGIN (Neon + loginHistory fichier)
  // =======================

  // POST /api/login
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

      const data = loadData(); // pour l'historique

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

      // Adhérent en base Neon
      pool.query(
        'SELECT login, pass, role, serre FROM members WHERE login = $1',
        [username]
      )
        .then(result => {
          if (result.rowCount === 0) {
            sendJson(res, 401, { success: false, error: 'unknown_user' });
            return;
          }

          const found = result.rows[0];
          if (found.pass !== password) {
            sendJson(res, 401, { success: false, error: 'bad_password' });
            return;
          }

          const role = found.role || 'adhérent';
          const serre = !!found.serre;
          const userObj = { username: found.login, role, serre };

          data.loginHistory = data.loginHistory || [];
          data.loginHistory.push({
            username: found.login,
            role,
            date: new Date().toISOString()
          });
          saveData(data);

          sendJson(res, 200, {
            success: true,
            user: userObj
          });
        })
        .catch(dbErr => {
          console.error('Erreur SELECT member pour login :', dbErr);
          sendText(res, 500, 'Erreur serveur');
        });
    });
    return;
  }

  // GET /api/history
  if (method === 'GET' && url === '/api/history') {
    const data = loadData();
    sendJson(res, 200, data.loginHistory || []);
    return;
  }

  // POST /api/history/clear
  if (method === 'POST' && url === '/api/history/clear') {
    const data = loadData();
    data.loginHistory = [];
    saveData(data);
    sendJson(res, 200, { success: true });
    return;
  }

  // =======================
  //        API POPULATION (Neon)
  // =======================

  // GET /api/population
  if (method === 'GET' && url === '/api/population') {
    const query = `
      SELECT
        member_username AS "memberUsername",
        species_name    AS "speciesName",
        source,
        total_count     AS "totalCount"
      FROM population
      ORDER BY member_username, species_name
    `;
    pool.query(query)
      .then(result => {
        sendJson(res, 200, result.rows);
      })
      .catch(err => {
        console.error('Erreur SELECT population :', err);
        sendText(res, 500, 'Erreur serveur');
      });
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

      const cleanEntries = entries
        .filter(e => e && e.speciesName)
        .map(e => ({
          memberUsername,
          speciesName: String(e.speciesName),
          source: e.source ? String(e.source) : '',
          totalCount: Number(e.totalCount) > 0 ? Number(e.totalCount) : 0
        }));

      const deleteQuery = 'DELETE FROM population WHERE member_username = $1';

      pool.query(deleteQuery, [memberUsername])
        .then(() => {
          if (cleanEntries.length === 0) {
            sendJson(res, 200, { success: true, count: 0 });
            return;
          }

          const insertQuery = `
            INSERT INTO population (member_username, species_name, source, total_count)
            VALUES ${cleanEntries.map((_, i) =>
              `($${4 * i + 1}, $${4 * i + 2}, $${4 * i + 3}, $${4 * i + 4})`
            ).join(', ')}
          `;

          const params = cleanEntries.flatMap(e => [
            e.memberUsername,
            e.speciesName,
            e.source,
            e.totalCount
          ]);

          return pool.query(insertQuery, params);
        })
        .then(insertResult => {
          if (!insertResult) return;
          sendJson(res, 200, { success: true, count: cleanEntries.length });
        })
        .catch(dbErr => {
          console.error('Erreur sync population :', dbErr);
          sendText(res, 500, 'Erreur serveur');
        });
    });
    return;
  }

  // =======================
  //        API ANNONCES (Neon)
  // =======================

  // GET /api/annonces
  if (method === 'GET' && url === '/api/annonces') {
    pool.query(
      'SELECT id, titre, type, description, categorie, auteur, prive, favori_par AS "favoriPar" FROM annonces ORDER BY id DESC'
    )
      .then(result => {
        sendJson(res, 200, result.rows);
      })
      .catch(err => {
        console.error('Erreur SELECT annonces :', err);
        sendText(res, 500, 'Erreur serveur');
      });
    return;
  }

  // POST /api/annonces
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

      const id = "annonce_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
      const prive = true;
      const favoriPar = [];

      const query = `
        INSERT INTO annonces (id, titre, type, description, categorie, auteur, prive, favori_par)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, titre, type, description, categorie, auteur, prive, favori_par AS "favoriPar"
      `;
      const params = [
        id,
        String(titre).trim(),
        String(type),
        (description || '').toString().trim(),
        String(categorie),
        String(auteur),
        prive,
        favoriPar
      ];

      pool.query(query, params)
        .then(result => {
          const annonce = result.rows[0];
          sendJson(res, 200, { success: true, annonce });
        })
        .catch(dbErr => {
          console.error('Erreur INSERT annonce :', dbErr);
          sendText(res, 500, 'Erreur serveur');
        });
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

      const query = `
        UPDATE annonces
        SET prive = NOT prive
        WHERE id = $1 AND auteur = $2
        RETURNING id, titre, type, description, categorie, auteur, prive, favori_par AS "favoriPar"
      `;
      pool.query(query, [id, username])
        .then(result => {
          if (result.rowCount === 0) {
            sendText(res, 403, 'Non autorisé ou annonce introuvable');
            return;
          }
          const annonce = result.rows[0];
          sendJson(res, 200, { success: true, annonce });
        })
        .catch(dbErr => {
          console.error('Erreur togglePrivate annonce :', dbErr);
          sendText(res, 500, 'Erreur serveur');
        });
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

      pool.query('SELECT favori_par FROM annonces WHERE id = $1', [id])
        .then(result => {
          if (result.rowCount === 0) {
            sendText(res, 404, 'Annonce introuvable');
            return;
          }
          let favoriPar = result.rows[0].favori_par || [];
          const idx = favoriPar.indexOf(username);
          if (idx === -1) favoriPar.push(username);
          else favoriPar.splice(idx, 1);

          const updateQuery = `
            UPDATE annonces
            SET favori_par = $1
            WHERE id = $2
            RETURNING id, titre, type, description, categorie, auteur, prive, favori_par AS "favoriPar"
          `;
          return pool.query(updateQuery, [favoriPar, id]);
        })
        .then(updateResult => {
          if (!updateResult) return;
          const annonce = updateResult.rows[0];
          sendJson(res, 200, { success: true, annonce });
        })
        .catch(dbErr => {
          console.error('Erreur toggleFavori annonce :', dbErr);
          sendText(res, 500, 'Erreur serveur');
        });
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

      pool.query(
        'SELECT auteur FROM annonces WHERE id = $1',
        [id]
      )
        .then(result => {
          if (result.rowCount === 0) {
            sendText(res, 404, 'Annonce introuvable');
            return;
          }

          const auteur = result.rows[0].auteur;
          const isOwner = auteur === username;
          const isAdminLike = role === 'admin' || role === 'membre_bureau';

          if (!isOwner && !isAdminLike) {
            sendText(res, 403, 'Non autorisé');
            return;
          }

          return pool.query('DELETE FROM annonces WHERE id = $1', [id]);
        })
        .then(deleteResult => {
          if (!deleteResult) return;
          sendJson(res, 200, { success: true });
        })
        .catch(dbErr => {
          console.error('Erreur DELETE annonce :', dbErr);
          sendText(res, 500, 'Erreur serveur');
        });
    });
    return;
  }

  // =======================
  //        API SERRE (fichier)
  // =======================

  // GET /api/serre
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

  // POST /api/serre/notes
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

  // POST /api/serre/bacs
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

  // POST /api/serre/feed
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
    filePath = '/Index.html';
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
