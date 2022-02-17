"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdsQueryEditor = void 0;
const lodash_1 = __importDefault(require("lodash"));
let ads_protos = require('google-ads-node/build/protos/protos.json');
const types_1 = require("./types");
const protoRoot = ads_protos.nested.google.nested.ads.nested.googleads.nested;
const protoVer = Object.keys(protoRoot)[0]; // e.g. "v9"
const protoRowType = protoRoot[protoVer].nested.services.nested.GoogleAdsRow;
const protoResources = protoRoot[protoVer].nested.resources.nested;
const protoEnums = protoRoot[protoVer].nested.enums.nested;
const protoCommonTypes = protoRoot[protoVer].nested.common.nested;
class AdsQueryEditor {
    constructor() {
        this.resourcesMap = {};
        this.primitiveTypes = ['string', 'int64', 'int32', 'float', 'double', 'bool'];
    }
    parseQuery(query, params) {
        // remove comments and empty lines
        let query_lines = [];
        for (let line of query.split('\n')) {
            if (line.startsWith('#') || line.trim() == '') {
                continue;
            }
            line = line.replace(/\-\-(.*)/g, '').trim();
            if (line.length > 0)
                query_lines.push(line);
        }
        query = query_lines.join('\n\r');
        query = '' + query.replace(/\s{2,}/g, ' ');
        let queryNormalized = this.normalizeQuery(query, params || {});
        let select_fields = query.replace(/(^\s*SELECT)|(\s*FROM .*)/gi, '')
            .split(',')
            .filter(function (field) {
            return field.length > 0;
        });
        let field_index = 0;
        let fields = [];
        let column_names = [];
        let customizers = [];
        for (let item of select_fields) {
            let pair = item.trim().toLowerCase().split(/ as /);
            let select_expr = pair[0];
            let alias = pair[1]; // can be undefined
            let parsed_expr = this.parseExpression(select_expr);
            customizers[field_index] = parsed_expr.customizer_type ? {
                type: parsed_expr.customizer_type,
                value: parsed_expr.customizer_value
            } :
                null;
            if (!parsed_expr.field_name || !parsed_expr.field_name.trim()) {
                throw new Error(`IncorrectQuerySyntax: empty select field at index ${field_index}`);
            }
            fields.push(parsed_expr.field_name);
            // fields.push(this.format_type_field_name(parsed_expr.field_name))
            let column_name = alias || parsed_expr.field_name;
            column_name = column_name.replace(/[ ]/g, '');
            // check for uniquniess
            if (column_names.includes(column_name)) {
                throw new Error(`InvalidQuerySyntax: duplicating column name ${column_name} at index ${field_index}`);
            }
            column_names.push(column_name);
            field_index++;
        }
        // parse query metadata (column types)
        let match = query.match(/ FROM ([^\s]+)/);
        if (!match || !match.length)
            throw new Error(`Could not parse resource from the query`);
        let resourceTypeFrom = this.getResource(match[1]);
        if (!resourceTypeFrom)
            throw new Error(`Could not find resource ${match[1]} specified in FROM in protobuf schema`);
        let resourceInfo = {
            name: match[1],
            typeName: resourceTypeFrom.name,
            typeMeta: resourceTypeFrom
        };
        let columnTypes = [];
        for (let i = 0; i < fields.length; i++) {
            let field = fields[i];
            let nameParts = field.split('.');
            let curType = this.getResource(nameParts[0]);
            let fieldType = this.getFieldType(curType, nameParts.slice(1));
            let customizer = customizers[i];
            if (customizer) {
                if (customizer.type === types_1.CustomizerType.NestedField) {
                    // we expect a field with nested_field customizer should ends with a type (not primitive, not enum)
                    // i.e. ProtoTypeMeta
                    if (lodash_1.default.isString(fieldType.type)) {
                        throw new Error(`InvalidQuery: field ${field} contains nested field accessor (:) but selected field's type is primitive (${fieldType.typeName})`);
                    }
                    if ((0, types_1.isEnumType)(fieldType.type)) {
                        throw new Error(`InvalidQuery: field ${field} contains nested field accessor (:) but selected field's type enum (${fieldType.typeName})`);
                    }
                    let repeated = fieldType.repeated;
                    fieldType =
                        this.getFieldType(fieldType.type, customizer.value.split('.'));
                    fieldType.repeated = repeated || fieldType.repeated;
                }
            }
            columnTypes.push(fieldType);
        }
        return new types_1.QueryElements(queryNormalized, fields, column_names, customizers, resourceInfo, columnTypes);
        /*
        // for (let line of query_lines) {
        //   // exclude SELECT keyword
        //   if (line.toUpperCase().startsWith('SELECT')) continue;
        //   // exclude everything that goes after FROM statement
        //   if (line.toUpperCase().startsWith('FROM')) {
        //     break;
        //   }
        //   let pair = line.split(/ [Aa][Ss] /);
        //   let select_expr = pair[0];
        //   let alias = pair[1];  // can be undefined
        //   let parsed_expr = this.parseExpression(select_expr);
        //   customizers[field_index] = parsed_expr.customizer_type ? {
        //     type: parsed_expr.customizer_type,
        //     value: parsed_expr.customizer_value
        //   } : null;
        //   parsed_expr.field_name = parsed_expr.field_name.replace(/[, ]/g, '');
        //   fields.push(parsed_expr.field_name);
        //   // fields.push(this.format_type_field_name(parsed_expr.field_name))
        //   let column_name = alias || parsed_expr.field_name;
        //   column_name = column_name.replace(/[, ]/g, '');
        //   column_names.push(column_name);
    
        //   field_index += 1
        // }
        */
    }
    getFieldType(type, nameParts) {
        if (!nameParts || !nameParts.length)
            throw new Error('ArgumentException: namePart should be empty');
        for (let i = 0; i < nameParts.length; i++) {
            let fieldType;
            let field = type.fields[nameParts[i]];
            let repeated = field.rule === 'repeated';
            let isLastPart = i === nameParts.length - 1;
            if (repeated && !isLastPart) {
                throw new Error(`InternalError: repeated field '${nameParts[i]}' in the middle of prop chain '${nameParts.join('.')}'`);
            }
            let fieldTypeName = field.type;
            // is it a primitive type?
            if (this.primitiveTypes.includes(fieldTypeName)) {
                fieldType = {
                    repeated,
                    type: fieldTypeName,
                    typeName: fieldTypeName,
                    kind: types_1.FieldTypeKind.primitive
                };
                // field with primitive type can be only at the end of property chain
                if (!isLastPart) {
                    throw new Error(`InternalError: field '${nameParts[i]}' in prop chain '${nameParts.join('.')}' has primitive type ${fieldTypeName}`);
                }
                return fieldType;
            }
            // is it a link to common type or enum
            else if (fieldTypeName.startsWith(`google.ads.googleads.${protoVer}.enums.`)) {
                // google.ads.googleads.v9.enums
                // e.g. "google.ads.googleads.v9.enums.CriterionTypeEnum.CriterionType"
                let match = fieldTypeName.match(/google\.ads\.googleads\.v[\d]+\.enums\.([^\.]+)\.([^\.]+)/i);
                if (!match || match.length < 3) {
                    throw new Error(`Could parse enum type reference ${fieldTypeName}`);
                }
                let enumType = protoEnums[match[1]].nested[match[2]];
                enumType['name'] = match[2];
                fieldType = {
                    repeated,
                    type: enumType,
                    typeName: match[2],
                    kind: types_1.FieldTypeKind.enum
                };
                // field with primitive type can be only at the end of property chain
                if (!isLastPart) {
                    throw new Error(`InternalError: field '${nameParts[i]}' in prop chain '${nameParts.join('.')}' has enum type ${fieldTypeName}`);
                }
                return fieldType;
            }
            else if (fieldTypeName.startsWith(`google.ads.googleads.${protoVer}.common.`)) {
                // google.ads.googleads.v9.common
                let match = fieldTypeName.match(/google\.ads\.googleads\.v[\d]+\.common\.([^\.]+)/i);
                if (!match || match.length < 2) {
                    throw new Error(`Could parse common type reference ${fieldTypeName}`);
                }
                let commonType = protoCommonTypes[match[1]];
                commonType['name'] = match[1];
                fieldType = {
                    repeated,
                    type: commonType,
                    typeName: match[1],
                    kind: types_1.FieldTypeKind.struct
                };
            }
            else {
                // then it's either another resource or a nested type
                if (type.nested && type.nested[fieldTypeName]) {
                    fieldType = {
                        repeated,
                        type: type.nested[fieldTypeName],
                        typeName: fieldTypeName,
                        kind: types_1.FieldTypeKind.struct
                    };
                }
                else if (protoResources[fieldTypeName]) {
                    fieldType = {
                        repeated,
                        type: protoResources[fieldTypeName],
                        typeName: fieldTypeName,
                        kind: types_1.FieldTypeKind.struct
                    };
                }
                else if (protoCommonTypes[fieldTypeName]) {
                    // yes, some fields refer to common types by a full name but some by a short one
                    fieldType = {
                        repeated,
                        type: protoCommonTypes[fieldTypeName],
                        typeName: fieldTypeName,
                        kind: types_1.FieldTypeKind.struct
                    };
                }
                else {
                    throw new Error(`InternalError: could not find a type proto for ${fieldTypeName} (field ${nameParts})`);
                }
            }
            type = fieldType.type;
            if (isLastPart)
                return fieldType;
        }
        throw new Error('InternalError');
    }
    getResource(fieldName) {
        let resourceType = this.resourcesMap[fieldName];
        if (resourceType)
            return resourceType;
        let resource = protoRowType.fields[fieldName];
        if (!resource)
            throw new Error(`Could not find resource ${resource} in protobuf schema`);
        // resource.type will be a full name like
        // "google.ads.googleads.v9.resources.AdGroup" or
        // "google.ads.googleads.v9.common.Metrics"
        // we need to get the last part and  find such a resource in
        let nameParts = resource.type.split('.');
        let resourceTypeName = nameParts[nameParts.length - 1];
        if (resource.type.startsWith(`google.ads.googleads.${protoVer}.resources.`)) {
            resourceType = protoResources[resourceTypeName];
        }
        else if (resource.type.startsWith(`google.ads.googleads.${protoVer}.common.`)) {
            resourceType = protoCommonTypes[resourceTypeName];
        }
        if (!resourceType) {
            throw new Error(`InternalError: could find resource ${resourceTypeName}`);
        }
        this.resourcesMap[fieldName] = resourceType;
        resourceType['name'] = resourceTypeName;
        return resourceType;
    }
    parseExpression(select_expr) {
        let resources = select_expr.split('~');
        // let pointers = select_expr.split('->');
        let nested_fields = select_expr.split(':');
        if (resources.length > 1) {
            if (!lodash_1.default.isInteger(+resources[1])) {
                throw new Error(`Expression '${select_expr}' contains indexed access ('~') but argument isn't a number`);
            }
            return {
                field_name: resources[0],
                customizer_type: types_1.CustomizerType.ResourceIndex,
                customizer_value: +resources[1]
            };
        }
        // if (pointers.length > 1) {
        //   if (!pointers[1]) {
        //     throw new Error(`Expression '${select_expr}' contains pointer access
        //     ('->') but the argument is empty`);
        //   }
        //   return {
        //     field_name: pointers[0],
        //     customizer_type: CustomizerType.Pointer,
        //     customizer_value: pointers[1]
        //   };
        // }
        if (nested_fields.length > 1) {
            if (!nested_fields[1]) {
                throw new Error(`Expression '${select_expr}' contains nested path (':') but path is empty`);
            }
            return {
                field_name: nested_fields[0],
                customizer_type: types_1.CustomizerType.NestedField,
                customizer_value: nested_fields[1]
            };
        }
        return { field_name: select_expr };
    }
    normalizeQuery(query, params) {
        query = this.removeAliases(query);
        query = this.removeCustomizers(query);
        // cut off the last comma
        query = query.replace(/,\s*FROM /gi, ' FROM ');
        // parse parameters and detected unspecified ones
        let unknown_params = [];
        query = query.replace(/\{([^}]+)\}/g, (ss, name) => {
            if (!params.hasOwnProperty(name)) {
                unknown_params.push(name);
            }
            return params[name];
        });
        if (unknown_params.length) {
            throw new Error(`The following parameters used in query and was not specified: ` +
                unknown_params);
        }
        return query;
    }
    removeAliases(query) {
        return query.replace(/\s+[Aa][Ss]\s+(\w+)/g, '');
    }
    removeCustomizers(query) {
        return query.replace(/->(\w+)|->/g, '')
            .replace(/~(\w+)|->/g, '')
            .replace(/:([^\s,]|$)+/g, '');
    }
}
exports.AdsQueryEditor = AdsQueryEditor;
//# sourceMappingURL=ads-query-editor.js.map