/// <binding Clean='clean' />
"use strict";

var gulp = require("gulp"),
    ts = require("gulp-typescript"),
    concat = require("gulp-concat"),
    clean = require("gulp-clean"),
    gseq = require("gulp-sequence"),
    tslint = require("gulp-tslint"),
    tsng = require("./"),
    tslintConfig = require("./tslint.json");

gulp.task("tslint", function () {
   return gulp.src(["example/src/**/*.ts", "!example/src/**/*.d.ts"], {
            base: "example/src"
        })
        .pipe(tslint(tslintConfig))
        .pipe(tslint.report("prose"));
});

gulp.task("tsng", function () {
    return gulp.src(["example/src/**/*.ts", "!example/src/**/*.d.ts"], {
            base: "example/src"
        })
        .pipe(tsng())
        .pipe(gulp.dest('example/out/'));
});

gulp.task("ts", function () {
    return gulp.src(["example/out/**/*.ts", "!example/out/**/*.d.ts"], {
            base: "example/out"
        })
        .pipe(ts({
            noImplicitAny: true,
			out: 'app.js'
        }))
        .pipe(gulp.dest("example/src/js"));
});

gulp.task("clean:tsng", function () {
   return gulp.src("example/out")
        .pipe(clean({force: true}));
});

gulp.task("compile:watcher", function (cb) {
    gseq("tslint", "tsng", "ts")(cb);
});

gulp.task("watch", function () {
    gulp.watch(["example/src/**/*.ts", "!example/src/**/*.d.ts"], ["compile:watcher"]);
});

gulp.task("compile", gseq("tslint", "tsng", "ts"));
gulp.task("test", ["compile"]);
gulp.task("default", ["compile"]);