export interface StartOptions {
  port: string;
  session: string;
}

export interface StopOptions {
  session: string;
}

export interface StatusOptions {
  session: string;
}

export interface UrlOptions {
  port: string;
}

export interface SessionInfo {
  name: string;
  created: Date;
  windows: number;
}
