/**
 * First import of main.ts: the settings file is read and put back into `localStorage` before any other module reads it
 * (the top-level await holds back every module imported after this one).
 */
import { bootSettings } from './settings-store';

await bootSettings();
