/*
 * grunt-hull-components
 * https://github.com/hull/grunt-hull-components
 *
 * Copyright (c) 2014 Hull
 * Licensed under the MIT license.
 */

'use strict';

var _ = require('lodash');
var path = require('path');
var Handlebars = require('handlebars');
var UglifyJS = require('uglify-js');
var gitRev = require('git-rev');

Handlebars.registerHelper('json', function(obj) {
  return JSON.stringify(obj);
});

module.exports = function(grunt) {

  function Component(mainFile, source, dest, options) {
    this.main = mainFile;
    this.version = options.version;
    this.sourcePath = path.resolve(source);
    this.name = path.relative(source, path.dirname(mainFile));
    this.basePath = path.dirname(mainFile);
    this.destPath = path.resolve(path.join(dest, this.name));
    this.options = options;
    this.files = {
      templates: this.listFiles(this.options.templates.extension),
      stylesheets: this.listFiles(this.options.stylesheets.extension || 'css'),
      javascripts: this.listFiles('js')
    };
    this.compiledTemplates = {};
  };

  Component.list = function(source, dest, options) {
    var components = [];
    grunt.file.expand({
      filter: 'isFile'
    }, path.join(source, '/**/**/main.js*')).forEach(function(main) {
      components.push(new Component(main, source, dest, options));
    });
    return components;
  };

  Component.buildPreviews = function(source, dest, data) {
    grunt.file.expand({
      filter: 'isFile',
      cwd: source
    }, '*.html').forEach(function(file) {
      data.initConfig = JSON.stringify(data.config.init);
      var preview = Handlebars.compile(grunt.file.read(path.join(source, file)))(data);
      grunt.file.write(path.join(dest, file), preview);
    });
  };

  Component.buildShip = function(dest, ship, schema) {
    _.map(ship.locales, function(translations, locale) {
      translations = translations || {};
      _.map(schema.definitions.translations.properties, function(tr, key) {
        translations[key] = translations[key] || tr.default;
      });
      ship.locales[locale] = translations;
    });
    grunt.file.write(path.join(dest, 'ship.json'), JSON.stringify(ship, null, "  "));
  };

  Component.buildSchema = function(dest, components) {
    var schemaFile = path.resolve('schema.yml');
    if (grunt.file.exists(schemaFile)) {
      var schema = grunt.file.readYAML(schemaFile);
      var allTranslations = [];
      _.map(components, function(component) {
        allTranslations = allTranslations.concat(component.extractTranslations());
      });
      allTranslations = _.uniq(allTranslations).sort();
      var props = {};
      schema.definitions.translations = {
        type: "object",
        properties: props
      };
      _.map(allTranslations, function(str) {
        props[str] = {
          type: "string",
          default: str,
          title: str
        };
      });
      grunt.file.write(path.join(dest, 'schema.json'), JSON.stringify(schema, null, "  "));
      return schema;
    }
  };

  Component.buildAll = function(files, options) {

    files.forEach(function(file) {
      // Concat specified files.
      var dest = file.dest || 'dist',
        components = [];

      file.src.forEach(function(src) {
        var list = Component.list(src + "/" + options.componentsDir, dest + "/" + options.componentsDir, options);
        components = components.concat(list);
        var componentsWithConfig = {};
        _.map(list, function(c) {
          var cfg = {};
          if (options.config.components && options.config.components[c.name]) {
            cfg = options.config.components[c.name];
          }
          return componentsWithConfig[c.name] = _.extend({}, c, {
            config: cfg
          });
        });

        Component.buildPreviews(src, dest, {
          components: componentsWithConfig,
          config: options.config,
          options: options
        });
      });

      _.invoke(components, 'build');

      var schema = Component.buildSchema(dest, components);

      if (options.config.ship) {
        Component.buildShip(dest, options.config.ship, schema);
      }
    });
  };

  Component.prototype = {
    listFiles: function(ext) {
      var pattern = '**/**/*';
      if (ext) pattern += '.' + ext;
      return grunt.file.expand({
        filter: 'isFile',
        cwd: this.basePath
      }, pattern);
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

    buildPkgFile: function() {
      var pkgFile = path.join(this.destPath, 'hull.json');
      var pkg = _.extend(_.pick(this, 'name', 'version', 'files'), {
        buildDate: new Date()
      });
      pkg.translations = this.extractTranslations();
      return grunt.file.write(pkgFile, JSON.stringify(pkg, null, 2));
    },

    buildMainFile: function() {

      var isJsx = /\.jsx$/.test(this.main), header;

      if (isJsx) {
        header = "/** @jsx React.DOM */\n";
      } else {
        header = this.buildTemplates();
      }

      // Build source
      var source = [
        header,
        grunt.file.read(this.main)
      ].join(" ; \n\n");


      if (isJsx) {
        var react = require('react-tools');
        source = react.transformWithDetails(source, { sourceMap: true, harmony: true, filename: 'main.source.js' }).code;
      }

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
        basePath = this.basePath,
        optimize = this.options.optimize;
      _.each(this.files.javascripts, function(file) {
        if (file !== 'main.js' && file != 'main.jsx') {
          if (optimize) {
            var minified = UglifyJS.minify(path.join(basePath, file))
            grunt.file.write(path.join(destPath, file), minified.code);
            grunt.file.write(path.join(destPath, file) + '.map', minified.map);
          } else {
            grunt.file.copy(path.join(basePath, file), path.join(destPath, file));
          }
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

    extractTranslations: function() {
      var self = this;

      if (this.translations) {
        return this.translations;
      }

      function _extract_(root, depth) {
        depth = depth || 0;
        var translations = [];
        var statements = root.statements || [];
        if (root.inverse && root.inverse.statements) {
          statements = statements.concat(root.inverse.statements);
        }
        if (statements && statements.length > 0) {
          _.map(statements, function(leaf) {
            if (leaf.type === 'mustache') {
              if (leaf.id && leaf.id.string === 't') {
                translations.push(leaf.params[0].string);
              }
            } else if (leaf.program) {
              translations = translations.concat(_extract_(leaf.program, depth + 1));
            }
          });
        }
        return _.uniq(translations).sort();
      };
      var ast = {
        statements: _.map(this.files.templates, function(tpl) {
          return {
            program: self.compileTemplate(tpl).ast
          }
        })
      };

      this.translations = _extract_(ast);

      return this.translations;
    },

    compileTemplate: function(tpl) {
      var tplPath = path.join(this.basePath, tpl);
      if (this.compiledTemplates[tplPath]) {
        return this.compiledTemplates[tplPath];
      }
      var srcPath = path.resolve(tplPath);
      var src = grunt.file.read(srcPath);
      var ast = Handlebars.parse(src);
      var fn = Handlebars.precompile(ast);
      this.compiledTemplates[tplPath] = {
        ast: ast,
        fn: fn
      };
      return this.compiledTemplates[tplPath];
    },

    buildTemplates: function() {
      var self = this,
        ns = this.options.templates.namespace,
        ext = this.options.templates.extension,
        compiledTemplates = this.compiledTemplates;

      var compiled = [],
        parts = ["this"];

      // Initialize namespace
      _.map(ns.split("."), function(part) {
        parts.push(part);
        var cur = parts.join(".");
        compiled.push(cur + " = " + cur + " || {}");
      });

      // Compile templates
      _.map(this.files.templates, function(tpl) {
        var tplName = [self.name, tpl.replace(new RegExp('\.' + ext), '')].join("/");
        var template = self.compileTemplate(tpl);
        compiled.push(ns + '[' + JSON.stringify(tplName) + ']=' + template.fn);
      });

      // Returned all templates as an Array
      return compiled.join(";\n");
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
