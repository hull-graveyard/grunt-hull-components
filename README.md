# grunt-hull-components

> A grunt task to build hull components.

## Getting Started
This plugin requires Grunt `~0.4.0`

If you haven't used [Grunt](http://gruntjs.com/) before, be sure to check out the [Getting Started](http://gruntjs.com/getting-started) guide, as it explains how to create a [Gruntfile](http://gruntjs.com/sample-gruntfile) as well as install and use Grunt plugins. Once you're familiar with that process, you may install this plugin with this command:

```shell
npm install grunt-hull-components --save-dev
```

Once the plugin has been installed, it may be enabled inside your Gruntfile with this line of JavaScript:

```js
grunt.loadNpmTasks('grunt-hull-components');
```

## The "hull_components" task

### Overview
In your project's Gruntfile, add a section named `hull_components` to the data object passed into `grunt.initConfig()`.

```js
grunt.initConfig({
  hull_components: {
    options: {
      optimize: true
    },
    your_target: {
      src: 'src',
      dest: 'dist'
    },
  },
});
```

### Options

#### options.optimize
Type: `Boolean`
Default value: `true`

Minify build components

### Usage Examples

```js
grunt.initConfig({
  hull_components: {
    options: {},
    components: {
      src: 'src',
      dest: 'dist'
    },
  },
});
```

then to run the build task : 

```
grunt hull_components
```

## Contributing
In lieu of a formal styleguide, take care to maintain the existing coding style. Add unit tests for any new or changed functionality. Lint and test your code using [Grunt](http://gruntjs.com/).

## Release History

### 0.1.0 First release (2014-05-18)
