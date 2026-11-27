// Vercel entry point: every path is rewritten here (see vercel.json).
import { handle } from "../addon.js";
import { CONFIGURE_HTML } from "../configure.js";

const h = (req) => handle(req, CONFIGURE_HTML);
export const GET = h;
export const HEAD = h;
export const POST = h;
export const OPTIONS = h;
