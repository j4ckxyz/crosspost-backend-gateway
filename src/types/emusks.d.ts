declare module "emusks" {
  export type EmusksClient =
    | "android"
    | "iphone"
    | "ipad"
    | "mac"
    | "old"
    | "web"
    | "tweetdeck";

  export interface EmusksLoginOptions {
    auth_token: string;
    client?: EmusksClient;
    proxy?: string;
  }

  export interface EmusksMediaCreateOptions {
    alt_text?: string;
    mediaType?: string;
    type?: "tweet" | "dm";
  }

  export interface EmusksTweetCreateOptions {
    mediaIds?: string[];
    replyTo?: string;
    quoteTweetId?: string;
    sensitive?: boolean;
  }

  export interface EmusksMediaUploadResponse {
    media_id?: string;
    media_id_string?: string;
    [key: string]: unknown;
  }

  export interface EmusksTweet {
    id?: string;
    text?: string;
    user?: {
      username?: string;
    };
    [key: string]: unknown;
  }

  export default class Emusks {
    user?: {
      username?: string;
    };

    login(tokenOrOptions: string | EmusksLoginOptions): Promise<unknown>;

    media: {
      create(
        source: string | Buffer | Uint8Array | ArrayBuffer | Blob,
        opts?: EmusksMediaCreateOptions,
      ): Promise<EmusksMediaUploadResponse>;
    };

    tweets: {
      create(text: string, opts?: EmusksTweetCreateOptions): Promise<EmusksTweet>;
    };
  }
}
