#!/usr/bin/env node
/**
 * Fetch the SAML IdP's public signing certificate from its metadata and write
 * it as a PEM file. passport-ubcshib requires this certificate to validate
 * signed SAML responses.
 *
 * Usage:
 *   npm run saml:fetch-cert
 *
 * Reads (with sensible LOCAL defaults) from the environment:
 *   SAML_IDP_METADATA_URL  (default: http://localhost:6122/simplesaml/saml2/idp/metadata.php)
 *   SAML_IDP_CERT_PATH     (default: ./server/certs/idp.pem)
 *
 * The IdP (docker-simple-saml) must be running.
 */
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';

const metadataUrl =
  process.env.SAML_IDP_METADATA_URL ||
  'http://localhost:6122/simplesaml/saml2/idp/metadata.php';
const outPath = process.env.SAML_IDP_CERT_PATH || './server/certs/idp.pem';

async function main() {
  let xml;
  try {
    const res = await fetch(metadataUrl);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    xml = await res.text();
  } catch (err) {
    console.error(`Failed to fetch IdP metadata from ${metadataUrl}`);
    console.error(`  ${err.message}`);
    console.error('Is docker-simple-saml running? (docker compose up -d)');
    process.exit(1);
  }

  const match = xml.match(
    /<(?:ds:)?X509Certificate[^>]*>([\s\S]*?)<\/(?:ds:)?X509Certificate>/,
  );
  if (!match) {
    console.error('No <X509Certificate> found in the IdP metadata.');
    process.exit(1);
  }

  const body = match[1].replace(/\s+/g, '');
  const lines = body.match(/.{1,64}/g) ?? [];
  const pem = `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, pem);
  console.log(`Wrote IdP certificate to ${outPath}`);
}

main();
