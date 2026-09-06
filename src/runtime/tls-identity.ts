/** Certificate name matching uses only certificate data; no engine operation is needed. */
const unfqdn = (name: string) => (name.endsWith('.') ? name.slice(0, -1) : name);
const ascii = (name: string) => {
  try {
    return new URL(`http://${name}`).hostname;
  } catch {
    return '';
  }
};
const ip = (name: string): string | undefined => {
  if (
    /^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(name) &&
    name.split('.').every((part) => Number(part) <= 255)
  )
    return name;
  if (!name.includes(':') || name.includes('[') || name.includes('%')) return undefined;
  try {
    return new URL(`http://[${name}]/`).hostname.slice(1, -1);
  } catch {
    return undefined;
  }
};
function matches(hostname: string, pattern: string): boolean {
  if (!pattern || /[^\x21-\x7f]/.test(pattern)) return false;
  const host = unfqdn(hostname).toLowerCase().split('.');
  const labels = unfqdn(pattern).toLowerCase().split('.');
  if (labels.length !== host.length || labels.some((label) => !label)) return false;
  if (labels.slice(1).some((label, index) => label !== host[index + 1])) return false;
  const first = labels[0];
  if (!first.includes('*') || first.includes('xn--')) return first === host[0];
  const parts = first.split('*');
  return (
    labels.length > 2 &&
    parts.length === 2 &&
    host[0].length >= parts[0].length + parts[1].length &&
    host[0].startsWith(parts[0]) &&
    host[0].endsWith(parts[1])
  );
}
function names(input: string): string[] {
  if (!input.includes('"')) return input.split(', ');
  const result: string[] = [];
  let token = '';
  for (let offset = 0; offset < input.length;) {
    if (input[offset] === '"') {
      const quoted = /^"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"/.exec(
        input.slice(offset),
      );
      if (!quoted)
        throw Object.assign(new SyntaxError('Invalid subject alternative name string'), {
          code: 'ERR_TLS_CERT_ALTNAME_FORMAT',
        });
      token += JSON.parse(quoted[0]);
      offset += quoted[0].length;
    } else if (input[offset] === ',') {
      result.push(token);
      token = '';
      offset += input[offset + 1] === ' ' ? 2 : 1;
    } else token += input[offset++];
  }
  result.push(token);
  return result;
}
export function checkServerIdentity(hostname: string, certificate: any): Error | undefined {
  hostname = unfqdn(String(hostname));
  const alternatives = certificate.subjectaltname;
  const dns: string[] = [],
    addresses: string[] = [];
  for (const name of alternatives ? names(alternatives) : []) {
    if (name.startsWith('DNS:')) dns.push(name.slice(4));
    else if (name.startsWith('IP Address:')) {
      const address = ip(name.slice(11));
      if (address) addresses.push(address);
    }
  }
  const address = ip(hostname);
  let valid = false,
    reason: string;
  if (address) {
    valid = addresses.includes(address);
    reason = `IP: ${hostname} is not in the cert's list: ${addresses.join(', ')}`;
  } else if (dns.length) {
    valid = dns.some((name) => matches(ascii(hostname), name));
    reason = `Host: ${hostname}. is not in the cert's altnames: ${alternatives}`;
  } else if (certificate.subject?.CN) {
    const cn = certificate.subject.CN;
    valid = (Array.isArray(cn) ? cn : [cn]).some((name) => matches(ascii(hostname), name));
    reason = `Host: ${hostname}. is not cert's CN: ${cn}`;
  } else reason = 'Cert does not contain a DNS name';
  if (!valid)
    return Object.assign(
      new Error(`Hostname/IP does not match certificate's altnames: ${reason}`),
      {
        code: 'ERR_TLS_CERT_ALTNAME_INVALID',
        reason,
        host: hostname,
        cert: certificate,
      },
    );
}
