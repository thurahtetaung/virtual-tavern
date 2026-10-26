import { setPatchClients } from './helpers.ts';

// Imported before a test file, so its sockets rebuild every room from patches.
setPatchClients(true);
