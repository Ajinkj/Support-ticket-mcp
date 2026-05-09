import { jwtVerify, createRemoteJWKSet, SignJWT } from 'jose';

// Firebase JWKS URL
const JWKS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
// Actually for jose jwtVerify, we need the standard JWK set, not the x509 certs.
const FIREBASE_JWKS_URL = 'https://www.googleapis.com/robot/v1/metadata/jwk/securetoken@system.gserviceaccount.com';

const JWKS = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));

export async function verifyFirebaseToken(token: string, projectId: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });
  return payload;
}

// Generate a symmetric key from the ADMIN_KEY
function getSecretKey(adminKey: string): Uint8Array {
  return new TextEncoder().encode(adminKey.padEnd(32, '0').slice(0, 32));
}

// Signs a stateless JWT acting as an authorization code or access token
export async function signStatelessToken(payload: Record<string, any>, adminKey: string, expiresIn: string = '1h') {
  const secret = getSecretKey(adminKey);
  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
  return jwt;
}

export async function verifyStatelessToken(token: string, adminKey: string) {
  const secret = getSecretKey(adminKey);
  const { payload } = await jwtVerify(token, secret);
  return payload;
}

// PKCE Challenge verification
export async function verifyCodeChallenge(codeVerifier: string, codeChallenge: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  
  // Base64Url encode the hash
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const base64Str = btoa(String.fromCharCode.apply(null, hashArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
    
  return base64Str === codeChallenge;
}
