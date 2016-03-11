interface IOptions {
    newLine?: string;
    extension?: string;
}

interface IDependencyMetadata {
    name: string;
    type: string;
}

interface IConfigFn {
    (...args: any[]): void;
}

interface ITsFileRegex {
    // //@NgModule('moduleName')
    // module My.Great.Module {
    moduleComment: RegExp;
    moduleDeclaration: RegExp

    // //@NgController('controllerName')
    // class MyController implements IMyViewModel {
    controllerComment: RegExp
    controllerDeclaration: RegExp

    // //@NgService('serviceName')
    // class MyService implements IMyService {
    serviceComment: RegExp
    serviceDeclaration: RegExp

    // //@NgDirective('directiveName')
    // class MyDirective implements ng.IDirective {
    directiveComment: RegExp
    directiveDeclaration: RegExp

    // //@NgFilter('filterName')
    // function filter(input: string) {
    filterComment: RegExp
    filterDeclaration: RegExp

    // constructor($window: ng.IWindowService) {
    constructor: RegExp

    closingBrace: RegExp
}

interface IStartupFnRegex {
    dependencies: RegExp;
    configFn: RegExp;
    runFn: RegExp;
}

interface IStartupFnMatches {
    dependencies?: RegExpMatchArray;
    configFn?: RegExpMatchArray;
    runFn?: RegExpMatchArray;
}

interface IModuleDefinition {
    name?: string;
    file?: any;
    fileExisted: boolean;
    dependencies: any[];
    fnName?: string;
    configFn?: IConfigFn;
    runFn?: IConfigFn;
    declarationLine?: number;
}

interface IClassDefinition {
    name?: string;
    module?: IModuleDefinition;
    fnName?: string;
    dependencies?: IArgumentDefinition[];
    file?: string;
}

interface IControllerDefinition extends IClassDefinition {
    ctorStartLine?: number;
    ctorEndLine?: number;
    startLine?: number;
    endLine?: number;
}

interface IServiceDefinition extends IClassDefinition {
    ctorStartLine?: number;
    ctorEndLine?: number;
}

interface IDirectiveDefinition extends IClassDefinition {
    classLine?: number;
    ctorStartLine?: number;
    ctorEndLine?: number;
}

interface IFilterDefinition extends IClassDefinition {
    
}

interface IArgumentDefinition {
    name?: string;
    type?: string;
}

interface IConstructorDefinition {
    args?: IArgumentDefinition[];
    startLine?: number;
    endLine?: number;
}

interface IFileResult {
    modules?: IModuleDefinition[];
    controllers?: IControllerDefinition[];
    services?: IServiceDefinition[];
    directives?: IDirectiveDefinition[];
    filters?: IFilterDefinition[];
    fileTally?: number;
    closingBraceLine?: number;
    
    file?: any;
    content?: string;
    path?: string;    
    module?: IModuleDefinition;
    error?: string;
}