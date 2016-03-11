"use strict";

import * as through from "through2";
import * as falafel from "falafel";
import * as gutil   from "gulp-util";
import File = require("vinyl");

var path = require("path");
var util = require("util");

module.exports = function (file: any, options?: IOptions) {
    options = options || {};

    // to preserve existing |undefined| behaviour and to introduce |newLine: ""| for binaries
    if (typeof options.newLine !== 'string') {
        options.newLine = gutil.linefeed;
    }

    if (typeof options.extension !== 'string') {
        options.extension = ".ts";
    }
    
    var angularTransform: AngularTransform;

    return through.obj(bufferContents, endStream);

    function bufferContents (file: File, enc: string, cb: ()=>void): void {
        // ignore empty files
        if (file.isNull()) {
            cb();
            return;
        }

        if (file.isStream()) {
            this.emit("error", new gutil.PluginError("gulp-tsng", "Streams are not supported!"));
            cb();
            return;
        }

        if (angularTransform == null) {
            angularTransform = new AngularTransform(this, options);
        }

        angularTransform.process(file);

        cb();
    }

    function endStream(cb?: ()=>void) {
        if (angularTransform != null) {
            angularTransform.emit(this, cb);
            return;
        }

        cb();
    }
}

class AngularTransform {
    private _options: IOptions;
    private _fileRegex: ITsFileRegex = {
            // //@NgModule('moduleName')
            // module My.Great.Module {
            moduleComment: /^\s*\/\/@NgModule(?:\(?['"]?([\w.]+)['"]?\)?\s*)?$/,
            moduleDeclaration: /^\s*(?:export\s+)?module\s*([\w.]*)\s*{\s*$/,

            // //@NgController('controllerName')
            // class MyController implements IMyViewModel {
            controllerComment: /^\s*\/\/@NgController(?:\(?['"]?([\w]*|skip\=true)['"]?\)?\s*)?$/,
            controllerDeclaration: /^\s*(?:export\s+)?class (\w+Controller)\s*/,

            // //@NgService('serviceName')
            // class MyService implements IMyService {
            serviceComment: /^\s*\/\/@NgService(?:\(?['"]?(\w+)['"]?\)?\s*)?$/,
            serviceDeclaration: /^\s*(?:export\s+)?class (\w+Service)\s+(?:implements\s+([\w.]+)\s*{)?/,

            // //@NgDirective('directiveName')
            // class MyDirective implements ng.IDirective {
            directiveComment: /^\s*\/\/@NgDirective(?:\(?['"]?(\w+)['"]?\)?\s*)?$/,
            directiveDeclaration: /^\s*(?:export\s+)?class (\w+Directive)\s+(?:implements\s+(\w.+)\s*{)?/,

            // //@NgFilter('filterName')
            // function filter(input: string) {
            filterComment: /^\s*\/\/\s*@NgFilter(?:\s*\(\s*['"]?(\w+)['"]?\s*\))?\s*$/,
            filterDeclaration: /^\s*function\s*([a-zA-Z_$]+)\s*\([a-zA-Z0-9_$:,\s]*\)/,

            // constructor($window: ng.IWindowService) {
            constructor: /constructor\s*\(\s*([^(]*)\s*\)\s*{/,

            closingBrace: /^\s*}\s*$/
        };
    private _startupFnRegex: IStartupFnRegex = {
            dependencies: /var\s+dependencies\s*=\s*\[([\w\s.,"']*)\]/,
            // BUG: This finds configuration functions that are commented out
            configFn: /function\s*(configuration)\s*\(\s*([\w$:.,\s]*)\s*\)\s*{/,
            // BUG: This finds run functions that are commented out
            runFn: /function\s*(run)\s*\(\s*([\w$:.,\s]*)\s*\)\s*{/
        };
    private _result: IFileResult = {
            modules: [],
            controllers: [],
            services: [],
            directives: [],
            filters: [],
            fileTally: 0
        };

    private _modules: any = {};
    private _files: any = {};
    private _depot: any;

    constructor(depot: any, options: IOptions) {
        this._depot = depot;
        this._options = options;
    }

    public process (file: File): void {
        var content: string = file.contents.toString();
        var filepath = file.path;

        var fileResult: IFileResult = this.processFile(content, filepath);

        fileResult.file = file;
        fileResult.content = content;
        fileResult.path = filepath;

        if (fileResult.error) {
            throw new Error(fileResult.error);
        }

        fileResult.module = this.mergeModules(fileResult);
        if (!fileResult.module) {
            throw new Error("File result for file " + filepath + " doesn't have a module");
        }

        if (!fileResult.module.file) {
            this._files[filepath] = fileResult;
        }

        this.sumResult(fileResult, this._result);
        this._result.modules.push(fileResult.module);
        this._result.fileTally++;
    }

    public emit (depot: any, cb: () => void): void {
        var serviceNames: string[] = this._result.services.map(function (service: IServiceDefinition) {
            return service.name;
        });

        // Emit module files
        var moduleNames: string[] = [];
        for (var moduleName in this._modules) {
            if (!this._modules.hasOwnProperty(moduleName)) {
                continue;
            }

            moduleNames.push(this._modules[moduleName].name);
        }

        for (var moduleName in this._modules) {
            if (!this._modules.hasOwnProperty(moduleName)) {
                continue;
            }

            var file: File = this.buildModuleFile(this._modules[moduleName], moduleNames, serviceNames);
            this.pushFile(file);
        }

        // Emit non-module files
        for (var filepath in this._files) {
            if (!this._files.hasOwnProperty(filepath)) {
                continue;
            }

            var fileResult: IFileResult = this._files[filepath];
            var file: File = this.updateFile(fileResult, serviceNames);
            this.pushFile(file);
        }

        cb();
    }

    private processFile (content: string, filepath: string): any {
        var result: IFileResult = {
            module: null,
            controllers: [],
            services: [],
            directives: [],
            filters: []
        };
        var lines: string[] = content.split(this._options.newLine);
        var module: any,
            line: string,
            matches: any,
            state: any,
            lastClosingBraceLine: number,
            error: string;
        var moduleFile: IModuleDefinition;
        var expecting: expect = expect.anything;

        for (var i: number = 0; i < lines.length; i++) {
            line = lines[i];

            //  Check for closing brace on a line by itself
            matches = line.match(this._fileRegex.closingBrace);
            if (matches) {
                lastClosingBraceLine = i;
                continue;
            }

            if (expecting === expect.anything) {
                // Check for module comment
                matches = line.match(this._fileRegex.moduleComment);
                if (matches) {
                    expecting = expect.moduleDeclaration;
                    state = matches;
                    continue;
                }

                // Check for module declaration
                matches = line.match(this._fileRegex.moduleDeclaration);
                if (matches) {
                    if (module) {
                        // A module is already declared for this file
                        error = "Error: " + filepath + "(" + i + "): Only one module can be declared per file";
                        break;
                    }

                    moduleFile = this.parseModuleFile(content);
                    moduleFile.name = matches[1];
                    moduleFile.declarationLine = i;
                    module = moduleFile;

                    state = null;
                }

                // Check for controller comment
                matches = line.match(this._fileRegex.controllerComment);
                if (matches) {
                    expecting = expect.controllerDeclaration;
                    state = matches;
                    continue;
                }

                // Check for controller declaration
                matches = line.match(this._fileRegex.controllerDeclaration);
                if (matches) {
                    var fnName = matches[1];
                    var name = (module ? module.name + "." : "") + fnName;
                    var ctor: IConstructorDefinition = this.parseConstructor(content) || { args: [] };

                    result.controllers.push({
                        module: module,
                        name: name,
                        fnName: fnName,
                        dependencies: ctor.args,
                        file: filepath,
                        ctorStartLine: ctor.startLine,
                        ctorEndLine: ctor.endLine
                    });
                    expecting = expect.anything;
                    continue;
                }

                // Check for service comment
                matches = line.match(this._fileRegex.serviceComment);
                if (matches) {
                    expecting = expect.serviceDeclaration;
                    state = matches;
                    continue;
                }

                // Check for service declaration
                matches = line.match(this._fileRegex.serviceDeclaration);
                if (matches) {
                    var className = matches[1];
                    var interfaceName = matches[2];
                    var name = (module ? module.name + "." : "") + (interfaceName || className);
                    var ctor: IConstructorDefinition = this.parseConstructor(content) || { args: [] };

                    result.services.push({
                        module: module,
                        name: name,
                        fnName: className,
                        dependencies: ctor.args,
                        file: filepath,
                        ctorStartLine: ctor.startLine,
                        ctorEndLine: ctor.endLine
                    });
                    expecting = expect.anything;
                    continue;
                }

                // Check for directive comment
                matches = line.match(this._fileRegex.directiveComment);
                if (matches) {
                    //debugger;
                    expecting = expect.directiveComment | expect.directiveDeclaration;
                    state = { names: [] };
                    state.names.push(matches[1]);
                    continue;
                }

                // Check for filter comment
                matches = line.match(this._fileRegex.filterComment);
                if (matches) {
                    expecting = expect.filterDeclaration;
                    state = matches;
                    continue;
                }
            }

            if (expecting === expect.moduleDeclaration) {
                // Check for module declaration
                matches = line.match(this._fileRegex.moduleDeclaration);
                if (matches) {
                    if (module) {
                        // A module is already declared for this file
                        error = "Error: " + filepath + "(" + i + "): Only one module can be declared per file";
                        break;
                    }

                    moduleFile = this.parseModuleFile(content);
                    moduleFile.name = state[1] || matches[1];
                    module = moduleFile;

                    state = null;
                    expecting = expect.anything;
                } else {
                    // A module comment was found but the next line wasn't a module declaration
                    error = "Error: " + filepath + "(" + i + "): @NgModule must be followed by a TypeScript module declaration, e.g. module My.Module.Name {";
                    break;
                }
            }

            if (expecting === expect.controllerDeclaration) {
                if (state[1] === "skip=true") {
                    state = null;
                    expecting = expect.anything;
                    continue;
                }

                // Check for controller declaration
                matches = line.match(this._fileRegex.controllerDeclaration);
                if (matches) {
                    (function () {
                        var name = (module ? module.name + "." : "") + (state[1] || matches[1]);
                        var ctor: IConstructorDefinition = this.parseConstructor(content) || { args: [] };

                        result.controllers.push({
                            module: module,
                            name: name,
                            fnName: matches[1],
                            dependencies: ctor.args,
                            file: filepath,
                            startLine: ctor.startLine,
                            endLine: ctor.endLine
                        });
                    }());
                    expecting = expect.anything;
                    continue;
                } else {
                    // A controller comment was found but the next line wasn't a controller declaration
                    error = "Error: " + filepath + "(" + i + "): @NgController must be followed by a TypeScript class declaration ending with 'Controller', e.g. class MyController implements IMyViewModel {";
                    break;
                }
            }

            if (expecting === expect.serviceDeclaration) {
                // Check for service declaration
                matches = line.match(this._fileRegex.serviceDeclaration);
                if (matches) {
                    (function () {
                        var className = matches[1];
                        var interfaceName = matches[2];
                        var name = (module ? module.name + "." : "") + ((state ? state[1] : null) || interfaceName || className);
                        var ctor: IConstructorDefinition = this.parseConstructor(content) || { args: [] };

                        result.services.push({
                            module: module,
                            name: name,
                            fnName: className,
                            dependencies: ctor.args,
                            file: filepath,
                            ctorStartLine: ctor.startLine,
                            ctorEndLine: ctor.endLine
                        });
                    }());
                    expecting = expect.anything;
                    continue;
                }
            }

            if (expecting & expect.directiveComment) {
                // Check for directive comment
                matches = line.match(this._fileRegex.directiveComment);
                if (matches) {
                    expecting = expect.directiveComment | expect.directiveDeclaration;
                    state.names.push(matches[1]);
                    continue;
                }
            }

            if (expecting & expect.directiveDeclaration) {
                // Check for directive function
                matches = line.match(this._fileRegex.directiveDeclaration);
                if (matches) {
                    (function () {
                        var fnName = matches[1];
                        var ctor: IConstructorDefinition = this.parseConstructor(content) || { args: [] };

                        state.names.forEach(function (name) {
                            result.directives.push({
                                module: module,
                                file: filepath,
                                name: name,
                                fnName: fnName,
                                classLine: i,
                                ctorStartLine: ctor.startLine,
                                ctorEndLine: ctor.endLine,
                                dependencies: ctor.args
                            });
                        });
                    }());
                    expecting = expect.anything;
                    continue;
                }
            }

            if (expecting === expect.filterDeclaration) {
                // Check for filter function
                matches = line.match(this._fileRegex.filterDeclaration);
                if (matches) {
                    result.filters.push({
                        module: module,
                        name: state[1] || matches[1],
                        fnName: matches[1],
                        file: filepath
                    });
                    state = null;
                    expecting = expect.anything;
                    continue;
                }
            }
        }

        // EOF
        if (expecting !== expect.anything) {
            error = "Error: End of file " + filepath + " reached while expecting " + expecting;
        }

        if (error) {
            result.error = error;
            return result;
        }

        result.closingBraceLine = lastClosingBraceLine;
        result.module = module;

        return result;
    }

    private parseConstructor (fileContents: string): IConstructorDefinition {
        // Extract details from constructor function
        // constructor($window: ng.IWindowService) {
        var regex: RegExp = /constructor\s*\(\s*([^(]*)\s*\)\s*{/;
        var matches: RegExpMatchArray = fileContents.match(regex);
        var ctor: IConstructorDefinition = {};

        if (!matches) {
            // Not found ctor
            return null;
        }

        ctor.args = [];
        if (matches[1]) {
            matches[1].split(",").forEach(function (argLine) {
                var argParts: string[] = argLine.split(":");
                var arg: IArgumentDefinition = { name: argParts[0].trim() };
                if (argParts.length > 1) {
                    arg.type = argParts[1].trim();
                }
                ctor.args.push(arg);
            });
        }

        // Find line numbers where the constructor function starts/ends
        var startIndex: number = fileContents.indexOf(matches[0]);
        var endIndex: number = startIndex + matches[0].length;

        ctor.startLine = fileContents.substr(0, startIndex).split(this._options.newLine).length - 1;
        ctor.endLine = fileContents.substr(0, endIndex).split(this._options.newLine).length - 1;

        return ctor;
    }

    private parseModuleFile (content: string): IModuleDefinition {
        var matches: IStartupFnMatches = {};
        var module: IModuleDefinition = <IModuleDefinition>{};

        for (var key in this._startupFnRegex) {
            if (!this._startupFnRegex.hasOwnProperty(key)) {
                continue;
            }

            matches[key] = content.match(this._startupFnRegex[key]);
            if (matches[key]) {
                module.fileExisted = true;
            }
        }

        if (!module.fileExisted) {
            return module;
        }

        if (matches.dependencies) {
            var members: string = matches.dependencies[1];
            var dependencies: string[] = [];
            if (members) {
                members.split(",").forEach(function (dependency) {
                    dependency = this.trim(dependency.trim(), ["\"", "'"]);
                    dependencies.push(dependency);
                }.bind(this));
            }
            module.dependencies = dependencies;
        }

        ["configFn", "runFn"].forEach(function (fnName: string) {
            if (matches[fnName]) {
                var args: string = matches[fnName][2];
                var dependencies: IDependencyMetadata[] = [];
                if (args) {
                    args.split(",").forEach(function (arg) {
                        var parts: string[] = arg.split(":");
                        var dependency: IDependencyMetadata = <IDependencyMetadata>{
                            name: parts[0].trim()
                        };

                        if (parts[1]) {
                            dependency.type = parts[1].trim();
                        }

                        dependencies.push(dependency);
                    });
                }
                module[fnName] = {
                    fnName: matches[fnName][1],
                    dependencies: dependencies
                };
            }
        });

        return module;
    }

    private sumResult (source: IFileResult, target: IFileResult): void {
        if (!source || !target) {
            return;
        }

        for (var key in target) {
            if (!target.hasOwnProperty(key) || !source.hasOwnProperty(key)) {
                continue;
            }

            var targetType: string = (typeof (target[key])).toLowerCase();
            var sourceType: string = (typeof (source[key])).toLowerCase();

            if (targetType !== sourceType) {
                continue;
            }

            if (targetType === "number" || targetType === "string") {
                target[key] = target[key] + source[key];
            } else if (Array.isArray(target[key])) {
                target[key] = target[key].concat(source[key]);
            }
        }
    }

    private buildModuleFile (module: IModuleDefinition, moduleNames: string[], serviceNames: string[]): File {
        var file: File = <File>module.file;
        // Not exist file
        if (!file) {
            var file: File = this.createModuleFile(module);
            module.file = file;
            return file;
        }
        
        this.updateModuleFile(file, module, moduleNames, serviceNames);
        return file;
    }
    
    private updateModuleFile (file: File, module: IModuleDefinition, moduleNames: string[], serviceNames: string[]): void {
        var content: string = "";

        // Module already has a file defined, just add the module registration
        var srcLines: string[] = file.contents.toString().split(this._options.newLine);

        //gulp.log.writeln("module.declarationLine=" + module.declarationLine);

        var startLine: number = module.declarationLine + 1;
        srcLines.forEach(function (line, i) {
            if (i === startLine) {

                // Add the module registration
                content += this.indent() + "angular.module(\"" + module.name + "\", [" + this._options.newLine;

                if (module.dependencies && module.dependencies.length) {
                    module.dependencies.forEach(function (d) {
                        var resolvedDependencyName = this.resolveTypeName(d, module.name, moduleNames);
                        content += this.indent(2) + "\"" + (resolvedDependencyName || d) + "\"," + this._options.newLine;
                    }.bind(this));
                }

                content += this.indent() + "])";

                ["config", "run"].forEach(function (method) {
                    var fn: any = module[method + "Fn"];
                    if (!fn) {
                        return;
                    }
                                        
                    content += "." + method + "([" + this._options.newLine;
                    fn.dependencies.forEach(function (d) {
                        var typeName;
                        if (d.name.substr(0, 1) === "$") {
                            typeName = d.name;
                        } else {
                            typeName = this.resolveTypeName(d.type, module.name, serviceNames);
                            if (!typeName) {
                                // Couldn't resolve type name
                                throw new Error("Error: Can't resolve dependency for module function " + module.name + "." + method + " with name " + d.type);
                            }
                        }
                        content += this.indent(2) + "\"" + typeName + "\"," + this._options.newLine;
                    }.bind(this));
                    content += this.indent(2) + fn.fnName + this._options.newLine + this.indent() + "])";
                }.bind(this));

                content += ";" + this._options.newLine + this._options.newLine;
            }

            content += line;

            if (i < (srcLines.length - 1)) {
                content += this._options.newLine;
            }
        }.bind(this));
        
        file.contents = new Buffer(content);        
    }
    
    private createModuleFile (module: IModuleDefinition): File {
        var filepath: string = module.name + this._options.extension;
        var content: string = "";
        // We need to render a whole file
        content = "module " + module.name + " {" + this._options.newLine;
        content += this.indent() + "angular.module(\"" + module.name + "\", []);" + this._options.newLine;
        content += "}";
        var file: File = new File({
            path: filepath,
            contents: new Buffer(content)
        });
        return file;
    }

    private updateFile (result: IFileResult, serviceNames: string[]): File {
        var file: File = result.file;
        var filepath: string = file.path;
        var content: string = "";
        var module: IModuleDefinition = result.module;
        var srcLines: string[] = result.content.split(this._options.newLine);
        var emitCtor: boolean = result.directives.length
                    && !result.directives[0].ctorStartLine;
        srcLines.forEach(function (line: string, i: number) {
            if (i === 0 && module.file) {
                // Add reference to module file
                // e.g. /// <reference path="../../MyModule.ng.ts" />

                content += "/// <reference path=\"" + path.relative(path.dirname(filepath), module.file.path) + "\" />" + this._options.newLine + this._options.newLine;
            }

            var emitBind: boolean = result.directives.length ?
                result.directives[0].ctorEndLine ?
                    (result.directives[0].ctorEndLine + 1) === i // Line after the ctor declartion ends
                    : (result.directives[0].classLine + 1) === i // No ctor already, so line after the class declaration
                : false;

            if (emitBind) {
                if (emitCtor) {
                    // Need to generate a ctor
                    content += this.indent(2) + "constructor() {" + this._options.newLine;
                }
                // Emit function to bind instance methods to 'this'
                content += this.indent(3) + "for (var m in this) {" + this._options.newLine;
                content += this.indent(4) + "if (this[m].bind) {" + this._options.newLine;
                content += this.indent(5) + "this[m] = this[m].bind(this);" + this._options.newLine;
                content += this.indent(4) + "}" + this._options.newLine;
                content += this.indent(3) + "}" + this._options.newLine;
                if (emitCtor) {
                    // Need to generate a ctor
                    content += this.indent(2) + "}" + this._options.newLine + this._options.newLine;
                }
            }

            if (i === result.closingBraceLine && module.file) {
                content += this.indent() + this._options.newLine;
                content += this.indent() + "angular.module(\"" + module.name + "\")";

                // Register controllers
                result.controllers.forEach(function (controller) {
                    content += this._options.newLine;
                    content += this.indent(2) + ".controller(\"" + controller.name + "\", [" + this._options.newLine;

                    if (controller.dependencies && controller.dependencies.length) {
                        controller.dependencies.forEach(function (d: IDependencyMetadata) {
                            var typeName: string;
                            if (d.name.substr(0, 1) === "$") {
                                typeName = d.name;
                            } else {
                                typeName = this.resolveTypeName(d.type, module.name, serviceNames);
                                if (!typeName) {
                                    // Couldn't resolve type name
                                    throw new Error("Error: Can't resolve dependency for controller " + controller.name + " with name " + d.type);
                                }
                            }
                            content += this.indent(3) + "\"" + typeName + "\"," + this._options.newLine;
                        }.bind(this));
                    }

                    content += this.indent(3) + controller.fnName + this._options.newLine;
                    content += this.indent(2) + "])";
                }.bind(this));

                // Register services
                result.services.forEach(function (service) {
                    content += this._options.newLine;
                    content += this.indent(2) + ".service(\"" + service.name + "\", [" + this._options.newLine;

                    if (service.dependencies && service.dependencies.length) {
                        service.dependencies.forEach(function (d) {
                            var typeName;
                            if (d.name.substr(0, 1) === "$") {
                                typeName = d.name;
                            } else {
                                typeName = this.resolveTypeName(d.type, module.name, serviceNames);
                                if (!typeName) {
                                    // Couldn't resolve type name
                                    throw new Error("Error: Can't resolve dependency for service " + service.name + " with name " + d.type);
                                }
                            }
                            content += this.indent(3) + "\"" + typeName + "\"," + this._options.newLine;
                        }.bind(this));
                    }

                    content += this.indent(3) + service.fnName + this._options.newLine;
                    content += this.indent(2) + "])";
                }.bind(this));

                // Register directives
                result.directives.forEach(function (directive) {
                    content += this._options.newLine;
                    content += this.indent(2) + ".directive(\"" + directive.name + "\", [" + this._options.newLine;

                    if (directive.dependencies && directive.dependencies.length) {
                        directive.dependencies.forEach(function (d) {
                            var typeName;
                            if (d.name.substr(0, 1) === "$") {
                                typeName = d.name;
                            } else {
                                typeName = this.resolveTypeName(d.type, module.name, serviceNames);
                                if (!typeName) {
                                    // Couldn't resolve type name
                                    throw new Error("Error: Can't resolve dependency for directive " + directive.name + " with name " + d.type);
                                }
                            }
                            content += this.indent(3) + "\"" + typeName + "\"," + this._options.newLine;
                        }.bind(this));
                    }

                    var alphabet = "abcdefghijklmnopqrstuvwxyz";
                    alphabet += alphabet.toUpperCase();

                    var argList = directive.dependencies.map(function (d, index) {
                        return alphabet.substr(index, 1);
                    });

                    content += this.indent(3) + "function (";
                    content += argList;
                    content += ") {" + this._options.newLine;
                    content += this.indent(4) + "return new " + directive.fnName + "(" + argList + ");" + this._options.newLine;
                    content += this.indent(3) + "}" + this._options.newLine;
                    content += this.indent(2) + "])";
                }.bind(this));

                // Register filters
                result.filters.forEach(function (filter) {
                    content += this._options.newLine;
                    content += this.indent(2) + ".filter(\"" + filter.name + "\", () => " + filter.fnName + ")";
                }.bind(this));

                content += ";" + this._options.newLine;
            }

            content += line;

            if (i < (srcLines.length - 1)) {
                content += this._options.newLine;
            }
        }.bind(this));

        return new File({
            path: file.path,
            base: file.base,
            contents: new Buffer(content)
        });
    }

    private pushFile (file: File): void {
        this._depot.push(file);
    }

    private mergeModules (result: IFileResult): IModuleDefinition {
        var module: IModuleDefinition = result.module;

        // Not found module
        if (!module) {
            return module;
        }

        // No angular types created, just no-op
        if (!module.fileExisted && !this.hasTypes(result)) {
            //console.log("Module " + module.name + " contains no angular types, skipping file emission");
            return module;
        }

        // New module
        if (!this._modules[module.name]) {
            this._modules[module.name] = module;

            if (module.fileExisted) {
                module.file = result.file;
            }

            return module;
        }

        // Existing module
        var resolvedModule: IModuleDefinition = this._modules[module.name];
        if (!module.fileExisted) {
            return resolvedModule;
        }

        if (resolvedModule.file) {
            // Error: Module defined in multiple files
            throw new Error("tsng: Module '" + module.name + "' defined in multiple files");
        }

        resolvedModule.file = result.file;

        return resolvedModule;
    }

    private resolveTypeName (typeName: string, moduleName: string, allNames: string[]): string {
        //console.log("TypeInfo:", { name: typeName, moduleName: moduleName, allNames: allNames });

        var prefix: string, matchedIndex: number;
        var parts: string[] = moduleName.split(".");

        if (parts.length === 1) {
            matchedIndex = allNames.indexOf(moduleName + "." + typeName);
            if (matchedIndex >= 0) {
                return allNames[matchedIndex];
            }
            // No match found!
            return null;
        }

        for (var i: number = parts.length - 1; i >= 0; i--) {
            prefix = "";
            parts.forEach(function (part, index) {
                if (index <= i) {
                    prefix += part + ".";
                }
            });

            matchedIndex = allNames.indexOf(prefix + typeName);
            if (matchedIndex >= 0) {
                return allNames[matchedIndex];
            }
        }

        // No match found!
        return null;
    }

    private hasTypes(result: IFileResult): boolean {
        return !!(
                (result.controllers && result.controllers.length) ||
                (result.services && result.services.length) ||
                (result.directives && result.directives.length) ||
                (result.filters && result.filters.length)
            );
    }

    private trim (target: string, chars: string[]): string{
        /// <param name="target" type="String" />
        /// <param name="chars" type="Array" />

        //debugger;

        var result: string, c: string, i: number;

        chars = chars || [" "];

        if (!target) {
            return target;
        }

        result = "";

        // Trim from start
        for (i = 0; i < target.length; i++) {
            c = target[i];
            if (chars.indexOf(c) < 0) {
                result = target.substr(i);
                break;
            }
        }

        // Trim from end
        for (i = result.length - 1; i >= 0; i--) {
            c = result[i];
            if (chars.indexOf(c) < 0) {
                result = result.substring(0, i + 1);
                break;
            }
        }

        return result;
    }

    private indent (length: number = 1, char = "    "): string {
        // length: Default to 1 level of indent
        // char:   Default to 4 spaces
        var result: string = "";
        for (var i = 0; i < length; i++) {
            result += char;
        }
        return result;
    }
}

enum expect {
    anything = 0,
    moduleDeclaration = 1,
    controllerDeclaration = 2,
    serviceDeclaration = 4,
    directiveComment = 8,
    directiveDeclaration = 16,
    filterDeclaration = 32
}