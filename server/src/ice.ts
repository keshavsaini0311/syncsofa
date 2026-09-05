type IceServer = { urls: string; username?: string; credential?: string };

export function iceServers(env: Record<string, string | undefined>): IceServer[] {
  const servers: IceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (env.TURN_URL && env.TURN_USERNAME && env.TURN_CREDENTIAL) {
    servers.push({ urls: env.TURN_URL, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL });
  }
  return servers;
}
