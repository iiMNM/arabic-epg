// Deno Deploy entry point
import { handle } from "./addon.js";
import { CONFIGURE_HTML } from "./configure.js";
Deno.serve((req) => handle(req, CONFIGURE_HTML));
