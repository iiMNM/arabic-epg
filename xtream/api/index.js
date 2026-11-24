// Vercel entry point: every path is rewritten here (see vercel.json).
import { handle } from "../xtream.js";
export const GET = handle;
export const HEAD = handle;
