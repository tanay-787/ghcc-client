export interface StartOptions {
  port?: string;
  session: string;
  public?: boolean;
}

export interface StopOptions {
  session?: string;
  all?: boolean;
}

export interface SessionInfo {
  name: string;
  created: Date;
  windows: number;
}
