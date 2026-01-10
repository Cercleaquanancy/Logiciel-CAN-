const http = require('http');
const fs = require('fs');
const path = require('path');
const pool = require('./db'); // connexion Neon

// IMPORTANT pour Render : utiliser process.env.PORT
const port = process.env.PORT || 5500;

// Fichier de stockage (pour serre, etc. – plus pour l’historique)
const DATA_FILE = path.join(__dirname, 'data.json');

// Admin "fixe"
const ADMIN_LOGIN = 'can';          // ou 'CAN.ansorgiinancy' si tu préfères
const ADMIN_PASS = '29081623';

// Charger les données du fichier (pour serre, population locale éventuelle, etc.)
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

// Sauvegarder les données dans le fichier (pour serre, etc.)
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
  //        API LOGIN (Neon + historique en base)
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

      const nowIso = new Date().toISOString();

      // Admin fixe
      if (username === ADMIN_LOGIN && password === ADMIN_PASS) {
        const userObj = { username, role: 'admin', serre: true };

        pool.query(
          'INSERT INTO login_history (username, role, date) VALUES ($1, $2, $3)',
          [username, 'admin', nowIso]
        )
          .then(() => {
            sendJson(res, 200, {
              success: true,
              user: userObj
            });
          })
          .catch(dbErr => {
            console.error('Erreur INSERT login_history admin :', dbErr);
            sendText(res, 500, 'Erreur serveur');
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

          return pool.query(
            'INSERT INTO login_history (username, role, date) VALUES ($1, $2, $3)',
            [found.login, role, nowIso]
          ).then(() => {
            sendJson(res, 200, {
              success: true,
              user: userObj
            });
          });
        })
        .catch(dbErr => {
          console.error('Erreur SELECT/INSERT login_history :', dbErr);
          sendText(res, 500, 'Erreur serveur');
        });
    });
    return;
  }

  // GET /api/history
  if (method === 'GET' && url === '/api/history') {
    pool.query(
      'SELECT username, role, date FROM login_history ORDER BY date DESC'
    )
      .then(result => {
        sendJson(res, 200, result.rows);
      })
      .catch(err => {
        console.error('Erreur SELECT login_history :', err);
        sendText(res, 500, 'Erreur serveur');
      });
    return;
  }

  // POST /api/history/clear
  if (method === 'POST' && url === '/api/history/clear') {
    pool.query('DELETE FROM login_history')
      .then(() => {
        sendJson(res, 200, { success: true });
      })
      .catch(err => {
        console.error('Erreur DELETE login_history :', err);
        sendText(res, 500, 'Erreur serveur');
      });
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
  //        API SERRE (Neon)
  // =======================

  // GET /api/serre
  if (method === 'GET' && url === '/api/serre') {
    Promise.all([
      pool.query('SELECT notes FROM serre_meta WHERE id = 1'),
      pool.query('SELECT id, name, last_water_change, last_filter_clean FROM serre_bacs ORDER BY id'),
      pool.query('SELECT member_username, bac_id FROM serre_assignments'),
      pool.query('SELECT last_update, monthly_use_kg FROM serre_feed WHERE id = 1'),
      pool.query('SELECT id, name, unit, quantity FROM serre_feed_items ORDER BY id')
    ])
      .then(([metaResult, bacsResult, assignResult, feedResult, feedItemsResult]) => {
        let notes = "";
        if (metaResult.rowCount > 0) {
          notes = metaResult.rows[0].notes || "";
        }

        const bacs = bacsResult.rows.map(row => ({
          id: row.id,
          name: row.name,
          lastWaterChange: row.last_water_change,
          lastFilterClean: row.last_filter_clean
        }));

        const assignments = {};
        assignResult.rows.forEach(row => {
          assignments[row.bac_id] = {
            membreId: row.member_username,
            nom: row.member_username
          };
        });

        let feed = {
          lastUpdate: null,
          items: [],
          monthlyUseKg: 0
        };
        if (feedResult.rowCount > 0) {
          const fr = feedResult.rows[0];
          feed.lastUpdate = fr.last_update || null;
          feed.monthlyUseKg = Number(fr.monthly_use_kg) || 0;
        }

        feed.items = feedItemsResult.rows.map(row => ({
          id: row.id,
          name: row.name,
          unit: row.unit,
          quantity: Number(row.quantity) || 0
        }));

        sendJson(res, 200, {
          notes,
          bacs,
          assignments,
          feed
        });
      })
      .catch(err => {
        console.error('Erreur GET /api/serre :', err);
        sendText(res, 500, 'Erreur serveur');
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
      const txt = typeof notes === 'string' ? notes : "";

      const query = `
        INSERT INTO serre_meta (id, notes)
        VALUES (1, $1)
        ON CONFLICT (id) DO UPDATE SET notes = EXCLUDED.notes
      `;
      pool.query(query, [txt])
        .then(() => {
          sendJson(res, 200, { success: true });
        })
        .catch(dbErr => {
          console.error('Erreur POST /api/serre/notes :', dbErr);
          sendText(res, 500, 'Erreur serveur');
        });
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
        id: String(b.id),
        name: String(b.name || "Bac serre"),
        lastWaterChange: b.lastWaterChange || null,
        lastFilterClean: b.lastFilterClean || null
      }));

      const assignObj = assignments && typeof assignments === 'object' ? assignments : {};

      const deleteBacs = 'DELETE FROM serre_bacs';
      const deleteAssign = 'DELETE FROM serre_assignments';

      pool.query(deleteBacs)
        .then(() => pool.query(deleteAssign))
        .then(() => {
          if (!cleanedBacs.length) {
            return null;
          }
          const insertQuery = `
            INSERT INTO serre_bacs (id, name, last_water_change, last_filter_clean)
            VALUES ${cleanedBacs.map((_, i) =>
              `($${4 * i + 1}, $${4 * i + 2}, $${4 * i + 3}, $${4 * i + 4})`
            ).join(', ')}
          `;
          const params = cleanedBacs.flatMap(b => [
            b.id,
            b.name,
            b.lastWaterChange,
            b.lastFilterClean
          ]);
          return pool.query(insertQuery, params);
        })
        .then(() => {
          const assignEntries = Object.entries(assignObj);
          if (!assignEntries.length) {
            sendJson(res, 200, { success: true });
            return null;
          }

          const insertAssignQuery = `
            INSERT INTO serre_assignments (member_username, bac_id)
            VALUES ${assignEntries.map((_, i) =>
              `($${2 * i + 1}, $${2 * i + 2})`
            ).join(', ')}
          `;
          const assignParams = assignEntries.flatMap(([bacId, val]) => [
            String(val.membreId),
            String(bacId)
          ]);

          return pool.query(insertAssignQuery, assignParams);
        })
        .then(result => {
          if (result === null) return;
          sendJson(res, 200, { success: true });
        })
        .catch(dbErr => {
          console.error('Erreur POST /api/serre/bacs :', dbErr);
          sendText(res, 500, 'Erreur serveur');
        });
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
            id: String(it.id || ("feed_" + Date.now() + "_" + idx)),
            name: String(it.name || ""),
            unit: String(it.unit || "kg"),
            quantity: Number(it.quantity) || 0
          }))
        : [];

      const mUse = Number(monthlyUseKg);
      const finalMonthly = isNaN(mUse) ? 0 : mUse;
      const nowIso = new Date().toISOString();

      const deleteItems = 'DELETE FROM serre_feed_items';
      const upsertFeed = `
        INSERT INTO serre_feed (id, last_update, monthly_use_kg)
        VALUES (1, $1, $2)
        ON CONFLICT (id) DO UPDATE SET last_update = EXCLUDED.last_update,
                                      monthly_use_kg = EXCLUDED.monthly_use_kg
      `;

      pool.query(deleteItems)
        .then(() => pool.query(upsertFeed, [nowIso, finalMonthly]))
        .then(() => {
          if (!cleanItems.length) {
            sendJson(res, 200, { success: true });
            return null;
          }

          const insertItemsQuery = `
            INSERT INTO serre_feed_items (id, name, unit, quantity)
            VALUES ${cleanItems.map((_, i) =>
              `($${4 * i + 1}, $${4 * i + 2}, $${4 * i + 3}, $${4 * i + 4})`
            ).join(', ')}
          `;
          const params = cleanItems.flatMap(it => [
            it.id,
            it.name,
            it.unit,
            it.quantity
          ]);

          return pool.query(insertItemsQuery, params);
        })
        .then(result => {
          if (result === null) return;
          sendJson(res, 200, { success: true });
        })
        .catch(dbErr => {
          console.error('Erreur POST /api/serre/feed :', dbErr);
          sendText(res, 500, 'Erreur serveur');
        });
    });
    return;
  }

  // =======================
  //    SERVEUR DE FICHIERS
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
