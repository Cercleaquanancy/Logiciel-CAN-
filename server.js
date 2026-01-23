const http = require('http');
const fs = require('fs');
const path = require('path');
const pool = require('./db');

const port = process.env.PORT || 5500;
const ADMIN_LOGIN = 'can';
const ADMIN_PASS = '29081623';

function sendJson(res, statusCode, obj) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(obj));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(text);
}

function parseJsonBody(req, callback) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 1e6) req.connection.destroy();
  });
  req.on('end', () => {
    try {
      callback(null, body ? JSON.parse(body) : {});
    } catch (e) {
      callback(e);
    }
  });
}

const server = http.createServer((req, res) => {
  const [pathOnly] = req.url.split('?');
  const url = pathOnly;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // ============ API MEMBRES ============
  if (method === 'GET' && url === '/api/members') {
    pool.query('SELECT login, pass, role, serre FROM members ORDER BY login ASC')
      .then(result => sendJson(res, 200, result.rows))
      .catch(err => {
        console.error('Erreur SELECT members:', err);
        sendText(res, 500, 'Erreur serveur');
      });
    return;
  }

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
      pool.query(
        'INSERT INTO members (login, pass, role, serre) VALUES ($1, $2, $3, $4) ON CONFLICT (login) DO UPDATE SET pass = EXCLUDED.pass, role = EXCLUDED.role, serre = EXCLUDED.serre',
        [login, pass, role || 'adhérent', !!serre]
      )
        .then(() => sendJson(res, 200, { success: true }))
        .catch(err => {
          console.error('Erreur INSERT member:', err);
          sendText(res, 500, 'Erreur serveur');
        });
    });
    return;
  }

  if (method === 'DELETE' && url.startsWith('/api/members/')) {
    const login = decodeURIComponent(url.replace('/api/members/', ''));
    pool.query('DELETE FROM members WHERE login = $1', [login])
      .then(result => sendJson(res, 200, { success: true, removed: result.rowCount }))
      .catch(err => {
        console.error('Erreur DELETE member:', err);
        sendText(res, 500, 'Erreur serveur');
      });
    return;
  }

  if (method === 'POST' && url === '/api/members/clear') {
    pool.query('DELETE FROM members')
      .then(() => sendJson(res, 200, { success: true }))
      .catch(err => {
        console.error('Erreur DELETE members:', err);
        sendText(res, 500, 'Erreur serveur');
      });
    return;
  }

  // ============ API LOGIN ============
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

      if (username === ADMIN_LOGIN && password === ADMIN_PASS) {
        pool.query('INSERT INTO login_history (username, role, date) VALUES ($1, $2, $3)', [username, 'admin', nowIso])
          .then(() => sendJson(res, 200, { success: true, user: { username, role: 'admin', serre: true } }))
          .catch(err => {
            console.error('Erreur INSERT login_history admin:', err);
            sendText(res, 500, 'Erreur serveur');
          });
        return;
      }

      pool.query('SELECT login, pass, role, serre FROM members WHERE login = $1', [username])
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
          pool.query('INSERT INTO login_history (username, role, date) VALUES ($1, $2, $3)', [found.login, role, nowIso])
            .then(() => sendJson(res, 200, { success: true, user: { username: found.login, role, serre } }))
            .catch(err => {
              console.error('Erreur INSERT login_history:', err);
              sendText(res, 500, 'Erreur serveur');
            });
        })
        .catch(err => {
          console.error('Erreur SELECT member:', err);
          sendText(res, 500, 'Erreur serveur');
        });
    });
    return;
  }

  if (method === 'GET' && url === '/api/history') {
    pool.query('SELECT username, role, date FROM login_history ORDER BY date DESC')
      .then(result => sendJson(res, 200, result.rows))
      .catch(err => {
        console.error('Erreur SELECT login_history:', err);
        sendText(res, 500, 'Erreur serveur');
      });
    return;
  }

  if (method === 'POST' && url === '/api/history/clear') {
    pool.query('DELETE FROM login_history')
      .then(() => sendJson(res, 200, { success: true }))
      .catch(err => {
        console.error('Erreur DELETE login_history:', err);
        sendText(res, 500, 'Erreur serveur');
      });
    return;
  }

  // ============ API POPULATION ============
  if (method === 'GET' && url === '/api/population') {
    pool.query('SELECT member_username AS "memberUsername", species_name AS "speciesName", source, total_count AS "totalCount", published FROM population ORDER BY member_username, species_name')
      .then(result => sendJson(res, 200, result.rows))
      .catch(err => {
        console.error('Erreur SELECT population:', err);
        sendText(res, 500, 'Erreur serveur');
      });
    return;
  }

  if (method === 'POST' && url === '/api/population/sync') {
    parseJsonBody(req, (err, body) => {
      if (err) {
        sendText(res, 400, 'JSON invalide');
        return;
      }
      const { memberUsername, entries } = body;
      if (!memberUsername || !Array.isArray(entries)) {
        sendText(res, 400, 'memberUsername et entries obligatoires');
        return;
      }
      const cleanEntries = entries
        .filter(e => e && e.speciesName)
        .map(e => ({
          memberUsername,
          speciesName: String(e.speciesName),
          source: e.source ? String(e.source) : '',
          totalCount: Number(e.totalCount) > 0 ? Number(e.totalCount) : 0,
          published: !!e.published
        }));

      pool.query('DELETE FROM population WHERE member_username = $1', [memberUsername])
        .then(() => {
          if (!cleanEntries.length) {
            sendJson(res, 200, { success: true, count: 0 });
            return null;
          }
          const insertQuery = `
            INSERT INTO population (member_username, species_name, source, total_count, published)
            VALUES ${cleanEntries.map((_, i) => `($${5*i+1}, $${5*i+2}, $${5*i+3}, $${5*i+4}, $${5*i+5})`).join(', ')}
          `;
          const params = cleanEntries.flatMap(e => [e.memberUsername, e.speciesName, e.source, e.totalCount, e.published]);
          return pool.query(insertQuery, params);
        })
        .then(result => {
          if (!result) return;
          sendJson(res, 200, { success: true, count: cleanEntries.length });
        })
        .catch(err => {
          console.error('Erreur sync population:', err);
          sendText(res, 500, 'Erreur serveur');
        });
    });
    return;
  }

  // ============ API EVENTS ============
  if (method === 'GET' && url.startsWith('/api/events')) {
    const queryString = req.url.split('?')[1] || '';
    const params = new URLSearchParams(queryString);
    const type = params.get('type') || 'all';
    const sort = params.get('sort') || 'date-asc';

    let query = 'SELECT id, titre, type, date_iso, heure, lieu, description, lien FROM events WHERE date_iso >= CURRENT_DATE';
    const dbParams = [];

    if (type && type !== 'all') {
      query += ' AND type = $1';
      dbParams.push(type);
    }

    if (sort === 'date-asc') query += ' ORDER BY date_iso ASC';
    else if (sort === 'date-desc') query += ' ORDER BY date_iso DESC';
    else if (sort === 'title-asc') query += ' ORDER BY titre ASC';
    else if (sort === 'title-desc') query += ' ORDER BY titre DESC';
    else query += ' ORDER BY date_iso ASC';

    pool.query(query, dbParams)
      .then(result => sendJson(res, 200, result.rows))
      .catch(err => {
        console.error('Erreur GET events:', err);
        sendText(res, 500, 'Erreur serveur');
      });
    return;
  }

  if (method === 'POST' && url === '/api/events') {
    parseJsonBody(req, (err, body) => {
      if (err) {
        sendText(res, 400, 'JSON invalide');
        return;
      }
      const { titre, type, date_iso, heure, lieu, description, lien } = body;
      if (!titre || !date_iso) {
        sendText(res, 400, 'titre et date_iso obligatoires');
        return;
      }
      const id = 'evt_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
      pool.query(
        'INSERT INTO events (id, titre, type, date_iso, heure, lieu, description, lien) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, titre, type, date_iso, heure, lieu, description, lien',
        [id, String(titre).trim(), String(type || 'autre'), String(date_iso), String(heure || ''), String(lieu || '').trim(), String(description || '').trim(), String(lien || '').trim()]
      )
        .then(result => sendJson(res, 200, { success: true, event: result.rows[0] }))
        .catch(err => {
          console.error('Erreur INSERT event:', err);
          sendText(res, 500, 'Erreur serveur');
        });
    });
    return;
  }

  if (method === 'PATCH' && url.startsWith('/api/events/')) {
    const id = decodeURIComponent(url.replace('/api/events/', ''));
    parseJsonBody(req, (err, body) => {
      if (err) {
        sendText(res, 400, 'JSON invalide');
        return;
      }
      const { titre, type, date_iso, heure, lieu, description, lien } = body;
      if (!titre || !date_iso) {
        sendText(res, 400, 'titre et date_iso obligatoires');
        return;
      }
      pool.query(
        'UPDATE events SET titre = $1, type = $2, date_iso = $3, heure = $4, lieu = $5, description = $6, lien = $7 WHERE id = $8 RETURNING id, titre, type, date_iso, heure, lieu, description, lien',
        [String(titre).trim(), String(type || 'autre'), String(date_iso), String(heure || ''), String(lieu || '').trim(), String(description || '').trim(), String(lien || '').trim(), id]
      )
        .then(result => {
          if (result.rowCount === 0) {
            sendText(res, 404, 'Événement introuvable');
            return;
          }
          sendJson(res, 200, { success: true, event: result.rows[0] });
        })
        .catch(err => {
          console.error('Erreur PATCH event:', err);
          sendText(res, 500, 'Erreur serveur');
        });
    });
    return;
  }

  if (method === 'DELETE' && url.startsWith('/api/events/')) {
    const id = decodeURIComponent(url.replace('/api/events/', ''));
    pool.query('DELETE FROM events WHERE id = $1', [id])
      .then(result => sendJson(res, 200, { success: true, removed: result.rowCount }))
      .catch(err => {
        console.error('Erreur DELETE event:', err);
        sendText(res, 500, 'Erreur serveur');
      });
    return;
  }

  // ============ API ANNONCES ============
  if (method === 'GET' && url === '/api/annonces') {
    pool.query('SELECT id, titre, type, description, categorie, auteur, prive, favori_par AS "favoriPar" FROM annonces ORDER BY id DESC')
      .then(result => sendJson(res, 200, result.rows))
      .catch(err => {
        console.error('Erreur SELECT annonces:', err);
        sendText(res, 500, 'Erreur serveur');
      });
    return;
  }

  if (method === 'POST' && url === '/api/annonces') {
    parseJsonBody(req, (err, body) => {
      if (err) {
        sendText(res, 400, 'JSON invalide');
        return;
      }
      const { titre, type, description, categorie, auteur } = body;
      if (!titre || !type || !categorie || !auteur) {
        sendText(res, 400, 'titre, type, categorie, auteur obligatoires');
        return;
      }
      const id = 'annonce_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
      pool.query(
        'INSERT INTO annonces (id, titre, type, description, categorie, auteur, prive, favori_par) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, titre, type, description, categorie, auteur, prive, favori_par AS "favoriPar"',
        [id, String(titre).trim(), String(type), String(description || '').trim(), String(categorie), String(auteur), true, []]
      )
        .then(result => sendJson(res, 200, { success: true, annonce: result.rows[0] }))
        .catch(err => {
          console.error('Erreur INSERT annonce:', err);
          sendText(res, 500, 'Erreur serveur');
        });
    });
    return;
  }

  if (method === 'PATCH' && url.startsWith('/api/annonces/') && url.includes('/togglePrivate')) {
    const id = decodeURIComponent(url.split('/')[3]);
    parseJsonBody(req, (err, body) => {
      if (err) {
        sendText(res, 400, 'JSON invalide');
        return;
      }
      const { username } = body;
      if (!username) {
        sendText(res, 400, 'username obligatoire');
        return;
      }
      pool.query('UPDATE annonces SET prive = NOT prive WHERE id = $1 AND auteur = $2 RETURNING id, titre, type, description, categorie, auteur, prive, favori_par AS "favoriPar"', [id, username])
        .then(result => {
          if (result.rowCount === 0) {
            sendText(res, 403, 'Non autorisé');
            return;
          }
          sendJson(res, 200, { success: true, annonce: result.rows[0] });
        })
        .catch(err => {
          console.error('Erreur PATCH togglePrivate:', err);
          sendText(res, 500, 'Erreur serveur');
        });
    });
    return;
  }

  if (method === 'PATCH' && url.startsWith('/api/annonces/') && url.includes('/toggleFavori')) {
    const id = decodeURIComponent(url.split('/')[3]);
    parseJsonBody(req, (err, body) => {
      if (err) {
        sendText(res, 400, 'JSON invalide');
        return;
      }
      const { username } = body;
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
          pool.query('UPDATE annonces SET favori_par = $1 WHERE id = $2 RETURNING id, titre, type, description, categorie, auteur, prive, favori_par AS "favoriPar"', [favoriPar, id])
            .then(updateResult => sendJson(res, 200, { success: true, annonce: updateResult.rows[0] }))
            .catch(err => {
              console.error('Erreur PATCH toggleFavori:', err);
              sendText(res, 500, 'Erreur serveur');
            });
        })
        .catch(err => {
          console.error('Erreur SELECT annonce favori:', err);
          sendText(res, 500, 'Erreur serveur');
        });
    });
    return;
  }

  if (method === 'DELETE' && url.startsWith('/api/annonces/')) {
    const id = decodeURIComponent(url.replace('/api/annonces/', '').split('/')[0]);
    parseJsonBody(req, (err, body) => {
      const { username, role } = body || {};
      if (!username) {
        sendText(res, 400, 'username obligatoire');
        return;
      }
      pool.query('SELECT auteur FROM annonces WHERE id = $1', [id])
        .then(result => {
          if (result.rowCount === 0) {
            sendText(res, 404, 'Annonce introuvable');
            return null;
          }
          const auteur = result.rows[0].auteur;
          const isOwner = auteur === username;
          const isAdmin = role === 'admin' || role === 'membre_bureau';
          if (!isOwner && !isAdmin) {
            sendText(res, 403, 'Non autorisé');
            return null;
          }
          return pool.query('DELETE FROM annonces WHERE id = $1', [id]);
        })
        .then(result => {
          if (!result) return;
          sendJson(res, 200, { success: true });
        })
        .catch(err => {
          console.error('Erreur DELETE annonce:', err);
          sendText(res, 500, 'Erreur serveur');
        });
    });
    return;
  }

  // ============ API SERRE ============
  if (method === 'GET' && url === '/api/serre') {
    Promise.all([
      pool.query('SELECT notes FROM serre_meta WHERE id = 1'),
      pool.query('SELECT id, name, last_water_change, last_filter_clean FROM serre_bacs ORDER BY id'),
      pool.query('SELECT member_username, bac_id FROM serre_assignments'),
      pool.query('SELECT last_update, monthly_use_kg FROM serre_feed WHERE id = 1'),
      pool.query('SELECT id, name, unit, quantity FROM serre_feed_items ORDER BY id')
    ])
      .then(([metaRes, bacsRes, assignRes, feedRes, itemsRes]) => {
        const notes = metaRes.rowCount > 0 ? metaRes.rows[0].notes || '' : '';
        const bacs = bacsRes.rows.map(r => ({
          id: r.id,
          name: r.name,
          lastWaterChange: r.last_water_change,
          lastFilterClean: r.last_filter_clean
        }));
        const assignments = {};
        assignRes.rows.forEach(r => {
          assignments[r.bac_id] = { membreId: r.member_username, nom: r.member_username };
        });
        let feed = { lastUpdate: null, items: [], monthlyUseKg: 0 };
        if (feedRes.rowCount > 0) {
          feed.lastUpdate = feedRes.rows[0].last_update;
          feed.monthlyUseKg = Number(feedRes.rows[0].monthly_use_kg) || 0;
        }
        feed.items = itemsRes.rows.map(r => ({
          id: r.id,
          name: r.name,
          unit: r.unit,
          quantity: Number(r.quantity)
        }));
        sendJson(res, 200, { notes, bacs, assignments, feed });
      })
      .catch(err => {
        console.error('Erreur GET serre:', err);
        sendText(res, 500, 'Erreur serveur');
      });
    return;
  }

  if (method === 'POST' && url === '/api/serre/notes') {
    parseJsonBody(req, (err, body) => {
      if (err) {
        sendText(res, 400, 'JSON invalide');
        return;
      }
      const { notes } = body;
      const txt = typeof notes === 'string' ? notes : '';
      pool.query('INSERT INTO serre_meta (id, notes) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET notes = EXCLUDED.notes', [txt])
        .then(() => sendJson(res, 200, { success: true }))
        .catch(err => {
          console.error('Erreur POST serre notes:', err);
          sendText(res, 500, 'Erreur serveur');
        });
    });
    return;
  }

  if (method === 'POST' && url === '/api/serre/bacs') {
    parseJsonBody(req, (err, body) => {
      if (err) {
        sendText(res, 400, 'JSON invalide');
        return;
      }
      const { bacs, assignments } = body;
      if (!Array.isArray(bacs)) {
        sendText(res, 400, 'bacs must be array');
        return;
      }
      const cleanBacs = bacs.map(b => ({
        id: String(b.id),
        name: String(b.name || 'Bac'),
        lastWaterChange: b.lastWaterChange || null,
        lastFilterClean: b.lastFilterClean || null
      }));
      const assignObj = (assignments && typeof assignments === 'object') ? assignments : {};

      pool.query('DELETE FROM serre_bacs')
        .then(() => pool.query('DELETE FROM serre_assignments'))
        .then(() => {
          if (!cleanBacs.length) return null;
          const query = `INSERT INTO serre_bacs (id, name, last_water_change, last_filter_clean) VALUES ${cleanBacs.map((_, i) => `($${4*i+1}, $${4*i+2}, $${4*i+3}, $${4*i+4})`).join(', ')}`;
          const params = cleanBacs.flatMap(b => [b.id, b.name, b.lastWaterChange, b.lastFilterClean]);
          return pool.query(query, params);
        })
        .then(() => {
          const entries = Object.entries(assignObj);
          if (!entries.length) {
            sendJson(res, 200, { success: true });
            return null;
          }
          const query = `INSERT INTO serre_assignments (member_username, bac_id) VALUES ${entries.map((_, i) => `($${2*i+1}, $${2*i+2})`).join(', ')}`;
          const params = entries.flatMap(([bacId, val]) => [String(val.membreId), String(bacId)]);
          return pool.query(query, params);
        })
        .then(result => {
          if (!result) return;
          sendJson(res, 200, { success: true });
        })
        .catch(err => {
          console.error('Erreur POST serre bacs:', err);
          sendText(res, 500, 'Erreur serveur');
        });
    });
    return;
  }

  if (method === 'POST' && url === '/api/serre/feed') {
    parseJsonBody(req, (err, body) => {
      if (err) {
        sendText(res, 400, 'JSON invalide');
        return;
      }
      const { items, monthlyUseKg } = body;
      const cleanItems = Array.isArray(items) ? items.map((it, i) => ({
        id: String(it.id || `feed_${Date.now()}_${i}`),
        name: String(it.name || ''),
        unit: String(it.unit || 'kg'),
        quantity: Number(it.quantity) || 0
      })) : [];
      const finalMonthly = Number(monthlyUseKg) || 0;
      const nowIso = new Date().toISOString();

      pool.query('DELETE FROM serre_feed_items')
        .then(() => pool.query('INSERT INTO serre_feed (id, last_update, monthly_use_kg) VALUES (1, $1, $2) ON CONFLICT (id) DO UPDATE SET last_update = EXCLUDED.last_update, monthly_use_kg = EXCLUDED.monthly_use_kg', [nowIso, finalMonthly]))
        .then(() => {
          if (!cleanItems.length) {
            sendJson(res, 200, { success: true });
            return null;
          }
          const query = `INSERT INTO serre_feed_items (id, name, unit, quantity) VALUES ${cleanItems.map((_, i) => `($${4*i+1}, $${4*i+2}, $${4*i+3}, $${4*i+4})`).join(', ')}`;
          const params = cleanItems.flatMap(it => [it.id, it.name, it.unit, it.quantity]);
          return pool.query(query, params);
        })
        .then(result => {
          if (!result) return;
          sendJson(res, 200, { success: true });
        })
        .catch(err => {
          console.error('Erreur POST serre feed:', err);
          sendText(res, 500, 'Erreur serveur');
        });
    });
    return;
  }

  // ============ API AQUARIUM ============
  if (method === 'GET' && url.startsWith('/api/aquarium')) {
    const qs = new URLSearchParams(req.url.split('?')[1] || '');
    const username = qs.get('username');
    if (!username) {
      sendText(res, 400, 'username required');
      return;
    }
    Promise.all([
      pool.query('SELECT notes FROM aquarium_notes WHERE username = $1', [username]),
      pool.query('SELECT id, name, last_water_change, last_filter_clean FROM aquarium_bacs WHERE username = $1 ORDER BY id', [username])
    ])
      .then(([notesRes, bacsRes]) => {
        const notes = notesRes.rowCount > 0 ? notesRes.rows[0].notes || '' : '';
        const bacs = bacsRes.rows.map(r => ({
          id: r.id,
          name: r.name,
          lastWaterChange: r.last_water_change,
          lastFilterClean: r.last_filter_clean
        }));
        sendJson(res, 200, { notes, bacs });
      })
      .catch(err => {
        console.error('Erreur GET aquarium:', err);
        sendText(res, 500, 'Erreur serveur');
      });
    return;
  }

  if (method === 'POST' && url === '/api/aquarium') {
    parseJsonBody(req, (err, body) => {
      if (err) {
        sendText(res, 400, 'JSON invalide');
        return;
      }
      const { username, notes, bacs } = body;
      if (!username) {
        sendText(res, 400, 'username required');
        return;
      }
      const txtNotes = typeof notes === 'string' ? notes : '';
      const cleanBacs = Array.isArray(bacs) ? bacs.map(b => ({
        id: String(b.id),
        name: String(b.name || 'Bac'),
        lastWaterChange: b.lastWaterChange || null,
        lastFilterClean: b.lastFilterClean || null
      })) : [];

      pool.query('BEGIN')
        .then(() => pool.query('INSERT INTO aquarium_notes (username, notes) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET notes = EXCLUDED.notes', [username, txtNotes]))
        .then(() => pool.query('DELETE FROM aquarium_bacs WHERE username = $1', [username]))
        .then(() => {
          if (!cleanBacs.length) return null;
          const query = `INSERT INTO aquarium_bacs (id, username, name, last_water_change, last_filter_clean) VALUES ${cleanBacs.map((_, i) => `($${5*i+1}, $${5*i+2}, $${5*i+3}, $${5*i+4}, $${5*i+5})`).join(', ')}`;
          const params = cleanBacs.flatMap(b => [b.id, username, b.name, b.lastWaterChange, b.lastFilterClean]);
          return pool.query(query, params);
        })
        .then(() => pool.query('COMMIT'))
        .then(() => sendJson(res, 200, { success: true }))
        .catch(err => {
          console.error('Erreur POST aquarium:', err);
          pool.query('ROLLBACK').catch(() => {});
          sendText(res, 500, 'Erreur serveur');
        });
    });
    return;
  }

  // ============ API BAC MEASURES ============
  if (method === 'GET' && url.startsWith('/api/bac/measures')) {
    const qs = new URLSearchParams(req.url.split('?')[1] || '');
    const username = qs.get('username');
    const tankId = qs.get('tankId');
    const type = qs.get('type') || 'aquarium';
    if (!username || !tankId) {
      sendText(res, 400, 'username et tankId required');
      return;
    }
    pool.query('SELECT id, date, temp, ph, gh, obs, repro FROM bac_measures WHERE username = $1 AND tank_id = $2 AND type = $3 ORDER BY date ASC', [username, String(tankId), type])
      .then(result => sendJson(res, 200, { history: result.rows }))
      .catch(err => {
        console.error('Erreur GET bac measures:', err);
        sendText(res, 500, 'Erreur serveur');
      });
    return;
  }

  if (method === 'POST' && url === '/api/bac/measures') {
    parseJsonBody(req, (err, body) => {
      if (err) {
        sendText(res, 400, 'JSON invalide');
        return;
      }
      const { username, tankId, type, entries } = body;
      if (!username || !tankId || !Array.isArray(entries)) {
        sendText(res, 400, 'username, tankId, entries required');
        return;
      }
      const t = type || 'aquarium';
      const cleanEntries = entries.map(e => ({
        date: e.date ? new Date(e.date).toISOString() : new Date().toISOString(),
        temp: (e.temp !== null && e.temp !== undefined && e.temp !== '') ? Number(e.temp) : null,
        ph: (e.ph !== null && e.ph !== undefined && e.ph !== '') ? Number(e.ph) : null,
        gh: (e.gh !== null && e.gh !== undefined && e.gh !== '') ? Number(e.gh) : null,
        obs: e.obs ? String(e.obs) : '',
        repro: !!e.repro
      }));

      pool.query('DELETE FROM bac_measures WHERE username = $1 AND tank_id = $2 AND type = $3', [username, String(tankId), t])
        .then(() => {
          if (!cleanEntries.length) {
            sendJson(res, 200, { success: true, count: 0 });
            return null;
          }
          const query = `INSERT INTO bac_measures (username, tank_id, type, date, temp, ph, gh, obs, repro) VALUES ${cleanEntries.map((_, i) => `($${9*i+1}, $${9*i+2}, $${9*i+3}, $${9*i+4}, $${9*i+5}, $${9*i+6}, $${9*i+7}, $${9*i+8}, $${9*i+9})`).join(', ')}`;
          const params = cleanEntries.flatMap(e => [username, String(tankId), t, e.date, e.temp, e.ph, e.gh, e.obs, e.repro]);
          return pool.query(query, params);
        })
        .then(result => {
          if (!result) return;
          sendJson(res, 200, { success: true, count: cleanEntries.length });
        })
        .catch(err => {
          console.error('Erreur POST bac measures:', err);
          sendText(res, 500, 'Erreur serveur');
        });
    });
    return;
  }

  // ============ API BAC POPULATION ============
  if (method === 'GET' && url.startsWith('/api/bac/population')) {
    const qs = new URLSearchParams(req.url.split('?')[1] || '');
    const username = qs.get('username');
    const tankId = qs.get('tankId');
    const type = qs.get('type') || 'aquarium';
    if (!username || !tankId) {
      sendText(res, 400, 'username et tankId required');
      return;
    }
    pool.query('SELECT fiche_id FROM bac_population WHERE username = $1 AND tank_id = $2 AND type = $3 ORDER BY id ASC', [username, String(tankId), type])
      .then(result => {
        const ids = result.rows.map(r => r.fiche_id);
        sendJson(res, 200, { ids });
      })
      .catch(err => {
        console.error('Erreur GET bac population:', err);
        sendText(res, 500, 'Erreur serveur');
      });
    return;
  }

  if (method === 'POST' && url === '/api/bac/population') {
    parseJsonBody(req, (err, body) => {
      if (err) {
        sendText(res, 400, 'JSON invalide');
        return;
      }
      const { username, tankId, type, ids } = body;
      if (!username || !tankId || !Array.isArray(ids)) {
        sendText(res, 400, 'username, tankId, ids required');
        return;
      }
      const t = type || 'aquarium';
      const cleanIds = ids.map(id => String(id)).filter(id => id.trim().length > 0);

      pool.query('DELETE FROM bac_population WHERE username = $1 AND tank_id = $2 AND type = $3', [username, String(tankId), t])
        .then(() => {
          if (!cleanIds.length) {
            sendJson(res, 200, { success: true, count: 0 });
            return null;
          }
          const query = `INSERT INTO bac_population (username, tank_id, type, fiche_id) VALUES ${cleanIds.map((_, i) => `($${4*i+1}, $${4*i+2}, $${4*i+3}, $${4*i+4})`).join(', ')}`;
          const params = cleanIds.flatMap(id => [username, String(tankId), t, id]);
          return pool.query(query, params);
        })
        .then(result => {
          if (!result) return;
          sendJson(res, 200, { success: true, count: cleanIds.length });
        })
        .catch(err => {
          console.error('Erreur POST bac population:', err);
          sendText(res, 500, 'Erreur serveur');
        });
    });
    return;
  }

  // ============ FICHIERS STATIQUES ============
  let filePath = url;
  if (filePath === '/' || filePath === '/index' || filePath === '/index.html') {
    filePath = '/Index.html';
  }
  filePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
  const fullPath = path.join(__dirname, filePath);
  const extname = String(path.extname(fullPath)).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
  };
  const contentType = mimeTypes[extname] || 'text/html';
  fs.readFile(fullPath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Server Error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(port, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${port}/`);
  console.log(`📦 Base de données: Neon (PostgreSQL)`);
  console.log(`🔐 Admin: ${ADMIN_LOGIN} / ${ADMIN_PASS}`);
});

module.exports = server;
