/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** slskd URL - URL of your slskd instance */
  "slskdUrl": string,
  /** API Key - slskd API key (auto-set by the Setup command — only change this if you configured slskd manually) */
  "apiKey"?: string,
  /** Format Preference - Preferred audio formats in order, comma-separated. Results are sorted so earlier formats appear first. */
  "formatPreference": string,
  /** Best Quality Mode - Prioritize lossless formats (FLAC, WAV) and highest-bitrate files first, overriding Format Preference */
  "bestQuality": boolean,
  /** Exclude Lossless - Skip FLAC, WAV, and other lossless files — useful if you only want small lossy files */
  "excludeFlac": boolean
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `search` command */
  export type Search = ExtensionPreferences & {}
  /** Preferences accessible in the `downloads` command */
  export type Downloads = ExtensionPreferences & {}
  /** Preferences accessible in the `setup` command */
  export type Setup = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `search` command */
  export type Search = {}
  /** Arguments passed to the `downloads` command */
  export type Downloads = {}
  /** Arguments passed to the `setup` command */
  export type Setup = {}
}

