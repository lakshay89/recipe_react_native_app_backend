const normalizeEmail = (email = '') => email.trim().toLowerCase();
const normalizeMobile = (mobile = '') => mobile.replace(/[^0-9+]/g, '').replace(/^0/, '+91');
const normalizeText = (value = '') => value.trim().replace(/\s+/g, ' ').toLowerCase();

module.exports = { normalizeEmail, normalizeMobile, normalizeText };
