// Impronte di riferimento calcolate in Node: il collaudo nel browser deve ottenere le stesse.
import { writeFileSync } from "node:fs";
import { playBot } from "../src/sim-core/bot";
writeFileSync("dist/node-hashes.json", JSON.stringify([1, 2, 3, 4242].map((s) => playBot("mirato", s).hash)));
