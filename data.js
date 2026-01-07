// URL de base de l'API (même serveur, même port)
const API_BASE = '';

/**
 * Récupérer tous les adhérents
 * @returns Promise<Array>
 */
async function apiGetMembers() {
  const res = await fetch(`${API_BASE}/api/members`);
  if (!res.ok) throw new Error('Erreur récupération membres');
  return res.json();
}

/**
 * Ajouter ou modifier un adhérent
 * @param {Object} user { login, pass, role, serre }
 */
async function apiSaveMember(user) {
  const res = await fetch(`${API_BASE}/api/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user)
  });
  if (!res.ok) throw new Error('Erreur enregistrement membre');
  return res.json();
}

/**
 * Supprimer un adhérent par login
 */
async function apiDeleteMember(login) {
  const res = await fetch(`${API_BASE}/api/members/${encodeURIComponent(login)}`, {
    method: 'DELETE'
  });
  if (!res.ok) throw new Error('Erreur suppression membre');
  return res.json();
}

/**
 * Vider tous les adhérents
 */
async function apiClearMembers() {
  const res = await fetch(`${API_BASE}/api/members/clear`, {
    method: 'POST'
  });
  if (!res.ok) throw new Error('Erreur clear membres');
  return res.json();
}

/**
 * Récupérer l'historique des connexions
 */
async function apiGetHistory() {
  const res = await fetch(`${API_BASE}/api/history`);
  if (!res.ok) throw new Error('Erreur récupération historique');
  return res.json();
}

/**
 * Vider l'historique des connexions
 */
async function apiClearHistory() {
  const res = await fetch(`${API_BASE}/api/history/clear`, {
    method: 'POST'
  });
  if (!res.ok) throw new Error('Erreur clear historique');
  return res.json();
}

/**
 * Essayer de se connecter
 * @param {string} username
 * @param {string} password
 * @returns Promise<{ success:boolean, user?:{username,role,serre}, error?:string }>
 */
async function apiLogin(username, password) {
  const res = await fetch(`${API_BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  // 200 OK -> succès, 401 -> erreur fonctionnelle
  const data = await res.json();
  if (!res.ok) {
    // on renvoie quand même data pour voir error: 'unknown_user' / 'bad_password'
    return { success: false, ...data };
  }
  return data; // { success:true, user: {...} }
}
