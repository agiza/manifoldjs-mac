'use strict';

var path = require('path'),
    util = require('util'),
    Q = require('q'),
    fs = require('fs'),
    url = require('url'),
    icongen = require('icon-gen');

var manifoldjsLib = require('manifoldjs-lib');

var CustomError = manifoldjsLib.CustomError,
    PlatformBase = manifoldjsLib.PlatformBase,
    manifestTools = manifoldjsLib.manifestTools,
    fileTools = manifoldjsLib.fileTools;

var constants = require('./constants');

var packager = require('electron-packager');
var npm = require("npm");

function Platform (packageName, platforms) {

  var self = this;
  var manifestFilePath;
  var name;

  PlatformBase.call(this, constants.platform.id, constants.platform.name, packageName, __dirname);

  // save platform list
  self.platforms = platforms;

  // override create function
  self.create = function (w3cManifestInfo, rootDir, options, callback) {
    if (w3cManifestInfo.format !== manifoldjsLib.constants.BASE_MANIFEST_FORMAT) {
      return Q.reject(new CustomError('The \'' + w3cManifestInfo.format + '\' manifest format is not valid for this platform.'));
    }

    var deferred = Q.defer();

    self.info('Generating the ' + constants.platform.name + ' app...');

    // if the platform dir doesn't exist, create it
    var platformDir = path.join(rootDir, constants.platform.id);
    var sourceTemplateDir = path.join(self.baseDir, 'template');
    var targetTemplateDir = path.join(platformDir, 'template'); 
    var imagesDir = path.join(platformDir, 'images');

    self.debug('Creating the ' + constants.platform.name + ' app folder...');
    fileTools.mkdirp(platformDir)
      // download icons to the app's folder
      .then(function () {
        return self.downloadIcons(w3cManifestInfo.content, w3cManifestInfo.content.start_url, imagesDir);      
      })
      .then(function() {
        // Converting png to icns`
        self.debug('Creating the app icon...');
        var convertOptions = {
          type: 'png',
          report: false,
          names: {
            icns: 'app'
          },
          modes: ['icns']
        };
        return icongen(imagesDir, imagesDir, convertOptions);
      })
      //copy the electron app template
      .then(function () {
          return fileTools.copyFolder(sourceTemplateDir, targetTemplateDir)
          .catch(function (err) {
            return Q.reject(new CustomError('Failed to copy the project template to the source folder.', err));
          });
      })
      // copy the documentation
      .then(function () {
        return self.copyDocumentation(platformDir);
      })      
      // write generation info (telemetry)
      .then(function () {
        return self.writeGenerationInfo(w3cManifestInfo, platformDir);
      })
      // persist the platform-specific manifest
      .then(function () {
        self.debug('Copying the ' + constants.platform.name + ' manifest to the app folder...');
        manifestFilePath = path.join(platformDir, 'manifest.json');
        return manifestTools.writeToFile(w3cManifestInfo, manifestFilePath);
      })
      .then(function() {
        var packageFilePath = path.join(platformDir, '/template/package.json');

        fs.readFile(packageFilePath, 'utf8', function (err,data) {
          if (err) {
            deferred.reject(err);
            return self.debug(err);
          }
          name = w3cManifestInfo.content.short_name.replace(/ /g,'');
          var result = data.replace(/replace/g, name);

          fs.writeFile(packageFilePath, result, 'utf8', function (err) {
            if (err) {
              deferred.reject(err);
              return self.debug(err);
            }
            self.debug('Generating ' + constants.platform.name + ' package');

            npm.load({
                loaded: false
            }, function (err) {
                if (err) {
                  deferred.reject(err);
                  return self.debug(err);
                }

                // installing dependencies
                var deps = ["electron-prebuilt@^1.2.0","electron-window-state@^3.0.3","color@^0.11.3"];

                npm.commands.install(targetTemplateDir, deps, function (err, data) {
                    if (err) {
                      deferred.reject(err);
                      return self.debug(err);
                    }                  
                    packager({
                        name: name,
                        dir: platformDir+'/template',
                        arch: constants.platform.arch,
                        platform: constants.platform.type,
                        out: platformDir+'/out',
                        prune: true,
                        icon: platformDir+'/images/app.icns',
                        overwrite: true
                    }, function done (err, appPath) {
                        if (err) {
                          deferred.reject(err);
                          return self.debug(err);
                        }
  
                        var p = path.join(platformDir
                        ,'/out/'
                        ,name
                        +'-'
                        +constants.platform.type
                        +'-'
                        +constants.platform.arch
                        ,name
                        +'.app/Contents/Resources/manifest.json')

                        fileTools.copyFile(manifestFilePath, p)
                        .then(function() {
                          deferred.resolve();
                        })
                        .catch(function (err) {
                          deferred.reject(err);
                          return self.debug(err);
                        });
                    });
                });
            });
          });
        })
      })
      .catch(function (err) {
          deferred.reject(err);
          return self.debug(err);
      });

      return deferred.promise.nodeify(callback);
  };
  
  self.getManifestIcons = function (manifest) {
    var manifestIcons = [];

    constants.platform.supportedIconSizes.forEach(function (size) {
      var icon = self.getManifestIcon(manifest, size);
      if (!!icon) {
        manifestIcons.push({ 
          fileName: size + '.' + constants.platform.supportedIconExtension,
          url: icon.src
        });
      }
    });

    return manifestIcons;
  };

  /**
   * Receives the size of a square icon (e.g. '50') and returns the corresponding icon element 
   * from the manifest or undefined if not found. The method looks for an icon that:
   * - Is square and has the specified size
   * - Has a specific extension or image type
   */
  self.getManifestIcon = function (manifest, size) {
    size = size.trim().toLowerCase();
    return (manifest.icons || []).find(function (icon) {
      var extension = path.extname(url.parse(icon.src).pathname);
      return (extension && extension.toLowerCase() === constants.platform.supportedIconExtension.toLowerCase() ||
         icon.type && icon.type.toLowerCase() === constants.platform.supportedIconType.toLowerCase())
         && icon.sizes.split(/\s+/).find(function (iconSize) { 
           var dimensions = iconSize.toLowerCase().split('x');
           return dimensions.length === 2 && dimensions[0] === size && dimensions[1] === size; 
        });
    });
  };

  self.addManifestIcon = function (manifest, fileName, size) {
    if (!manifest.icons) {
      manifest.icons = [];
    }
    
    manifest.icons.push({ 'src': fileName, 'sizes': size.toLowerCase().trim()});
  };
}

util.inherits(Platform, PlatformBase);

module.exports = Platform;
