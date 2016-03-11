/// <reference path="../../references.d.ts" />

module demo.app {
    var dependencies = [
        "ngRoute",
        "demo.controllers",
        "demo.services"
    ];

    function configuration ($logProvider: ng.ILogProvider) {
        $logProvider.debugEnabled(true);
    }

    function run ($log: ng.ILogService) {
        $log.log("App started.");
    }
}