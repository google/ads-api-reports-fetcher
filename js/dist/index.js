"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadAdsConfigYaml = exports.GoogleAdsApiClient = void 0;
/**
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
__exportStar(require("./lib/ads-api-client"), exports);
__exportStar(require("./lib/ads-query-editor"), exports);
__exportStar(require("./lib/ads-query-executor"), exports);
__exportStar(require("./lib/bq-executor"), exports);
__exportStar(require("./lib/bq-writer"), exports);
__exportStar(require("./lib/file-writers"), exports);
__exportStar(require("./lib/file-utils"), exports);
__exportStar(require("./lib/google-cloud"), exports);
__exportStar(require("./lib/types"), exports);
__exportStar(require("./lib/logger"), exports);
__exportStar(require("./lib/logger-factory"), exports);
__exportStar(require("./lib/utils"), exports);
__exportStar(require("./lib/ads-utils"), exports);
// for backward-compatibility
var ads_api_client_1 = require("./lib/ads-api-client");
Object.defineProperty(exports, "GoogleAdsApiClient", { enumerable: true, get: function () { return ads_api_client_1.GoogleAdsRpcApiClient; } });
var ads_utils_1 = require("./lib/ads-utils");
Object.defineProperty(exports, "loadAdsConfigYaml", { enumerable: true, get: function () { return ads_utils_1.loadAdsConfigFromFile; } });
//# sourceMappingURL=index.js.map