import { readFileSync, writeFileSync } from "fs";
const j = JSON.parse(readFileSync("cs.json","utf8"));
writeFileSync("colorspace.cpp", Buffer.from(j.content.replace(/\n/g,""),"base64"));
console.log("colorspace.cpp", (readFileSync("colorspace.cpp").length), "bytes");
