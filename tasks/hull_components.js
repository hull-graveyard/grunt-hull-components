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
    this.name         = path.relative(source, path.dirname(mainFile));
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
          components = [];

      file.src.forEach(function(source) {
        var list = Component.list(source, dest, options);
        components = components.concat(list);
        var componentsWithConfig = {}; 
        _.map(list, function(c) {
          var cfg = {};
          if (options.config.components && options.config.components[c.name]) {
            cfg = options.config.components[c.name];
          }
          return componentsWithConfig[c.name] = _.extend({}, c, { config: cfg });
        });
        Component.buildPreviews(source, dest, { components: componentsWithConfig, config: options.config, options: options });
      });
      _.invoke(components, 'build');
    });
  };

  Component.prototype = {
    listFiles: function(ext)  {
      var pattern = '**/**/*';
      if (ext) pattern += '.' + ext;
      return grunt.file.expand({ filter: 'isFile', cwd: this.basePath }, pattern);
    },

    buildTasks: ['cleanDestPath', 'buildPkgFile', 'buildMainFile', 'buildJsVendors', 'buildCssVendors'],

    build: function() {
      _.each(this.buildTasks, function(fn) { 
        console.warn("Build task: ", fn);
        this[fn].call(this); 
      }.bind(this));
    },

    cleanDestPath: function() {
      if (grunt.file.exists(this.destPath)) {
        grunt.file.delete(this.destPath);
      }    
    },

    buildPkgFile: function() {
      var pkgFile = path.join(this.destPath, 'hull.json');
      var pkg = _.extend(_.pick(this, 'name', 'version', 'files'), {
        buildDate: new Date()
      });

      return grunt.file.write(pkgFile, JSON.stringify(pkg, null, 2));
    },

    buildMainFile: function() {
      // Build source
      var source = [
        this.buildTemplates(),
        grunt.file.read(this.main)
      ].join(" ; \n\n");

      // Write results
      var mainDebugFile = this.destPath + '/main.debug.js';
      var mainFile = this.destPath + '/main.js';
      grunt.file.write(mainDebugFile, source);

      // Minify
      var minified = UglifyJS.minify(mainDebugFile);
      grunt.file.write(mainFile, minified.code);
      grunt.file.write(mainFile + '.map', minified.map);

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
      var compiled = [], parts = ["this"];
      
      // Initialize namespace
      _.map(ns.split("."), function(part) {
        parts.push(part);
        var cur = parts.join(".");
        compiled.push(cur + " = " + cur + " || {}");
      });

      // Compile templates
      _.map(this.files.templates, function(tpl) {
        var tplName = [self.name, tpl.replace(new RegExp('\.' + ext), '')].join("/");
        var srcPath   = path.resolve(path.join(self.basePath, tpl));
        var src = grunt.file.read(srcPath);
        var ast = Handlebars.parse(src);
        var ret = Handlebars.precompile(ast);
        compiled.push(ns + '[' + JSON.stringify(tplName) + ']=' + ret);
      });

      // Returned all templates as an Array
      return compiled.join(";\n");
    }
  }

  grunt.registerMultiTask('hull_components', 'A grunt task to build hull components.', function() {
    
    var done = this.async();

    var options = this.options({
      templates: {
        extension: 'hbs',
        wrapped: false,
        namespace: 'Hull.templates._default'
      },
      stylesheets: {
        extension: 'css'
      }
    });

    if (grunt.file.exists(this.data.dest)) {
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
        git.tag(buildAll);
      } else {
        buildAll(branch);
      }
      done();
    });

  });
    

};
