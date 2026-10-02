const { API_BASE_URL, INTEGRATION_KEY, PUBLIC_FORM_ID } = process.env;
if (!API_BASE_URL || !INTEGRATION_KEY || !PUBLIC_FORM_ID) {
  throw new Error('Set API_BASE_URL, INTEGRATION_KEY and PUBLIC_FORM_ID before running this example.');
}
const base = new URL(API_BASE_URL);
if (!['http:', 'https:'].includes(base.protocol)) throw new Error('API_BASE_URL must use HTTP or HTTPS.');
const url = new URL(`/api/integrations/forms/${encodeURIComponent(PUBLIC_FORM_ID)}/schema`, base);
const response = await fetch(url, { headers: { authorization: `Bearer ${INTEGRATION_KEY}` } });
if (!response.ok) throw new Error(`Schema request failed: HTTP ${response.status}. Check the key, permissions and published form.`);
console.log(JSON.stringify(await response.json(), null, 2));
