"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var yargs_1 = __importDefault(require("yargs"));
var commandHandler_1 = __importDefault(require("./commandHandler"));
function run() {
    yargs_1.default();
    commandHandler_1.default.run();
}
exports.run = run;
exports.default = {
    run: run
};
/*

  Commands:
  - gendocs help
  - gendocs register
  - gendocs docs:create
  - gendocs docs:list
  - gendocs init
  - gendocs publish

  - gendocs subdomain

  - gendocs domains:add
  - gendocs domains:list

  // TODO: init should download the existing pages

  // TODO: show error when insert fails (when meilisearch is down for example)

  // TODO: if certificate already exists, overwrite/keep (so we don't get stuck)

*/
