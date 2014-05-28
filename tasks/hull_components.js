/*
 * grunt-hull-components
 * https://github.com/hull/grunt-hull-components
 *
 * Copyright (c) 2014 Hull
 * Licensed under the MIT license.
 */

'use strict';

var _           = require('lodash');
var path        = require('path');
var Handlebars  = require('handlebars');
var UglifyJS    = require('uglify-js');
var gitRev      = require('git-rev');

Handlebars.registerHelper('json', function(obj) {
  return JSON.stringify(obj);
});

module.exports = function(grunt) {

  function Component(mainFile, source, dest, options) {
    this.main         = mainFile;
    this.version      = options.version;
    this.sourcePath   = path.resolve(source);
    this.name         = path.relative(source, path.dirname(mainFile)).replace('src/', '');
    this.basePath     = path.dirname(mainFile);
    this.destPath     = path.resolve(path.join(dest, this.name));
    this.options      = options;
    this.files        = {
      templates:    this.listFiles(this.options.templates.extension),
      stylesheets:  this.listFiles(this.options.stylesheets.extension || 'css'),
      javascripts:  this.listFiles('js')
    }
  };

  Component.list = function(source, dest, options) {
    var components = [];
    grunt.file.expand({ filter: 'isFile' }, path.join(source, '/**/**/main.js')).forEach(function(main) {
      components.push(new Component(main, source, dest, options))
    });
    return components;
  };

  Component.buildPreviews = function(source, dest, data) {
    grunt.file.expand({ filter: 'isFile', cwd: source }, '*.html').forEach(function(file) {
      data.initConfig = JSON.stringify(data.config.init);
      var preview = Handlebars.compile(grunt.file.read(path.join(source, file)))(data);
      grunt.file.write(path.join(dest, file), preview);
    });
  },

  Component.buildAll = function(files, options) {

    files.forEach(function(file) {
      // Concat specified files.
      var dest = file.dest || 'dist',
          componentSource = file.sourceName,
          components = [];

      file.src.forEach(function(source) {
        var list = Component.list(source, dest, options);
        components = components.concat(list);
        var componentsWithConfig = {};
        _.map(list, function(c) {
          var cfg = {};
          if (options.config && options.config.components && options.config.components[c.name]) {
            cfg = options.config.components[c.name];
          }
          return componentsWithConfig[c.name] = _.extend({}, c, { config: cfg });
        });
        Component.buildPreviews(source, dest, { components: componentsWithConfig, config: options.config, options: options });
      });
      _.invoke(components, 'build');

      var sourceName = file.sourceName || file.dest;
      var sourceDestFile = path.resolve(file.dest + ".js");
      console.warn("Finished building: ", sourceDestFile, sourceName);
      var sources = [], sourcePackage = {
        source: sourceName,
        components: {}
      };

      sources.push("(function(__component_source__) {");
      _.each(components, function(component) {
        sources.push(grunt.file.read(component.destPath + "/main.js"));
        sourcePackage.components[component.name] = component.package();
      });
      sources.push("})('" + sourceName + "')");
      grunt.file.write(path.resolve(file.dest + "/hull-components.js"),   sources.join(";"));
      grunt.file.write(path.resolve(file.dest + "/hull-components.json"), JSON.stringify(sourcePackage, undefined, 2));
    });



  };

  Component.prototype = {
    listFiles: function(ext)  {
      var pattern = '**/**/*';
      if (ext) pattern += '.' + ext;
      return grunt.file.expand({ filter: 'isFile', cwd: this.basePath }, pattern);
    },

    buildTasks: ['buildPkgFile', 'buildMainFile', 'buildJsVendors', 'buildCssVendors'],

    build: function() {
      var start = new Date();
      var title = "Building Component '" + this.name + "'";
      grunt.log.subhead(title);
      grunt.log.writeln(Array(title.length + 1).join('-'));
      var prev = start;
      _.each(this.buildTasks, function(fn) {
        this[fn].call(this);
        var t = new Date();
        grunt.log.ok(fn.replace(/^build/, '') + " (" + (t - prev) + "ms)");
        prev = t;
      }.bind(this));
      var t = new Date() - start;
      grunt.log.ok("Done (total:" + t + "ms)");
      grunt.log.writeln(Array(title.length + 1).join('-'));
    },

    package: function() {
      return _.extend(_.pick(this, 'name', 'version', 'files'), {
        buildDate: new Date()
      });
    },

    buildPkgFile: function() {
      var pkgFile = path.join(this.destPath, 'hull.json');
      return grunt.file.write(pkgFile, JSON.stringify(this.package(), null, 2));
    },

    buildMainFile: function() {
      // Build source
      var source = [
        "(function(Hull, __component_name__) {",
        "var __component_fullname__ = __component_name__;",
        "if (typeof(__component_source__) === 'string') { __component_fullname__ += '@' + __component_source__ };",
        "var __prevHullComponent__ = Hull.component;",
        "Hull.component = function(def) { __prevHullComponent__(__component_fullname__, def); };",
        this.buildTemplates(),
        grunt.file.read(this.main),
        "; Hull.component = __prevHullComponent__;",
        "})(Hull, '" + this.name + "');"
      ].join("\n");

      // Write results
      var mainDebugFile = this.destPath + '/main.debug.js';
      var mainFile = this.destPath + '/main.js';
      grunt.file.write(mainDebugFile, source);

      if (this.options.optimize) {
        // Minify
        var minified = UglifyJS.minify(mainDebugFile);
        grunt.file.write(mainFile, minified.code);
        grunt.file.write(mainFile + '.map', minified.map);
      } else {
        grunt.file.write(mainFile, source);
      }

    },

    buildJsVendors: function() {
      var destPath = this.destPath,
          basePath = this.basePath;
      _.each(this.files.javascripts, function(file) {
        if (file !== 'main.js') {
          var minified = UglifyJS.minify(path.join(basePath, file))
          grunt.file.write(path.join(destPath, file), minified.code);
          grunt.file.write(path.join(destPath, file) + '.map', minified.map);
        }
      });
    },

    buildCssVendors: function() {
      var destPath = this.destPath,
          basePath = this.basePath;
      _.each(this.files.stylesheets, function(file) {
        grunt.file.write(path.join(destPath, file), grunt.file.read(path.join(basePath, file)));
      });
    },

    buildTemplates: function() {
      var self = this, ns = this.options.templates.namespace, ext = this.options.templates.extension;
      var compiled = [], parts = ["root"];
      
      // Initialize namespace
      _.map(ns.split("."), function(part) {
        parts.push(part);
        var cur = parts.join(".");
        compiled.push(cur + " = " + cur + " || {}");
      });

      // Compile templates
      _.map(this.files.templates, function(tpl) {
        var tplName = tpl.replace(new RegExp('\.' + ext + '$'), '');
        var srcPath   = path.resolve(path.join(self.basePath, tpl));
        var src = grunt.file.read(srcPath);
        var ast = Handlebars.parse(src);
        var ret = Handlebars.precompile(ast);
        compiled.push(ns + '[__component_name__ + "/' + tplName + '"]=' + ret);
      });

      var templatesFile = this.destPath + '/templates.js';

      var result = "(function(root, __component_name__) {" + compiled.join(";\n") + "})(this, '" + this.name + "');"

      grunt.file.write(templatesFile, result);

      // Returned all templates as an Array
      return result;
    }
  }

  grunt.registerMultiTask('hull_components', 'A grunt task to build hull components.', function() {


    var done = this.async();

    var options = this.options({
      optimize: true,
      templates: {
        extension: 'hbs',
        wrapped: false,
        namespace: 'Hull.templates._default'
      },
      stylesheets: {
        extension: 'css'
      }
    });

    var keepDests = grunt.config.get('hull_components.options.keepDests') || [];

    if (grunt.file.exists(this.data.dest) && !_.include(keepDests, this.data.dest)) {
      keepDests.push(this.data.dest);
      grunt.config.set('hull_components.options.keepDests', keepDests);
      grunt.file.delete(this.data.dest);
    }

    var files = this.files;

    // Parse current version
    function buildAll(version) {
      options.version = version;
      Component.buildAll(files, options);
    }

    gitRev.branch(function(branch) {
      if (['HEAD', 'master'].indexOf(branch) !== -1) {
        gitRev.tag(function(tag) {
          buildAll(tag);
          done();
        });
      } else {
        buildAll(branch);
        done();
      }
    });
  });
};
