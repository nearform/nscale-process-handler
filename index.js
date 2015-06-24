/*
 * THIS SOFTWARE IS PROVIDED ``AS IS'' AND ANY EXPRESSED OR IMPLIED
 * WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
 * OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT,
 * INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
 * STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING
 * IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

'use strict';

var fs = require('fs-extra');
var _ = require('lodash');
var pathFromRepoUrl = require('./helpers').pathFromRepoUrl;
var path = require('path');
var spawn = require('child_process').spawn;
var bunyan = require('bunyan');
var pidHandler = require('./pid')();
var toTargetIp = require('nscale-target-ip');



module.exports = function(logger) {
  logger = logger || bunyan.createLogger({name: 'process-container'});
  var baseCmd = 'test -f ~/.bashrc && source ~/.bashrc; test -f ~/.bash_profile && source ~/.bash_profile; ';

  var tryOutput = function(str, out) {
    try { out.stdout(str); } catch(err) {}
  };



  var dockerHostIp = function() {
    var split;
    if (process.env.DOCKER_HOST) {
      split = /tcp:\/\/([0-9.]+):([0-9]+)/g.exec(process.env.DOCKER_HOST);
      if (split) {
        return split[1];
      }
    }
    return '127.0.0.1';
  };



  var handleIpAddress = function(container, cmd) {
    var ipAddress;

    if (container.specific) {
      ipAddress = container.specific.privateIpAddress || container.specific.ipAddress || container.specific.ipaddress;
      cmd = cmd.replace(/__TARGETIP__/g, toTargetIp(ipAddress));
    }
    return cmd;
  };



  var generateEnvironment = function(containerEnv) {
    var envArgs = ' ';
    _.each(_.keys(containerEnv), function(key) {
      envArgs += 'export ' + key + '=' + containerEnv[key] + ';';
    });
    return envArgs;
  };



  var preview = function(containerDef, out) {
    if (containerDef && containerDef.specific && containerDef.specific.execute && containerDef.specific.execute.process) {
      out.preview({cmd: containerDef.specific.execute.process, host: 'localhost'});
    }
    else {
      out.preview({cmd: 'missing execute block for container: ' + containerDef.id + ' deploy will fail', host: 'localhost'});
    }
  };



  var run = function(system, container, containerDef, out, cb) {
    var toExec;
    var cmd;
    var cwd;
    var env;
    var child;
    var logDir;
    var envArgs = '';


    cmd = containerDef.specific.execute.process;
    cwd = pathFromRepoUrl(system, containerDef);
    if (containerDef.specific.execute.cwd) {
      cwd = path.join(cwd, containerDef.specific.execute.cwd);
    }

    logDir = path.join(system.repoPath, 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirsSync(logDir);
    }

    if (container.specific && container.specific.environment) {
      envArgs = generateEnvironment(container.specific.environment);
    }

    toExec = baseCmd + envArgs + 'exec ' + cmd + ' >>' + logDir + '/' + container.id + '.log' + ' 2>>' + logDir + '/' + container.id + '.errors';
    toExec = handleIpAddress(container, toExec);

    if (!cmd) { 
      return cb(new Error('missing execute.process in service definition'), {});
    }
    env = Object.create(process.env);
    env.DOCKER_HOST_IP = dockerHostIp();
    child = spawn('/bin/bash', ['-c', toExec], {cwd: cwd, env: env, detached: true,});
    child.unref();

    child.on('error', function(err) {
      logger.error('process ' + cmd + ' failed with error ' + err);
      tryOutput('process ' + cmd + ' failed with error ' + err, out);
    });

    child.on('exit', function(code) {
      logger.error('process ' + cmd + ' exited with code ' + code);
      tryOutput('process ' + cmd + ' exited with code ' + code, out);
    });

    cb(null, child.pid);
  };



  var start = function(mode, target, system, containerDef, container, out, cb) {
    logger.info('starting');
    out.stdout('starting');

    if (mode === 'preview') {
      preview(containerDef, out);
      return cb();
    }
    else {
      if (!(containerDef && containerDef.specific && containerDef.specific.execute && containerDef.specific.execute.process)) {
        return cb(new Error('missing execute block for container: ' + containerDef.id + ' aborting'));
      }
    }

    run(system, container, containerDef, out, function(err, pid) {
      if (mode !== 'preview') {
        pidHandler.writePidFile(pid, system, target, container, cb);
      }
      else {
        cb();
      }
    });
  };



  var stop = function stop(mode, target, system, containerDef, container, out, cb) {
    if (mode === 'preview') {
      return cb();
    }
    if (container.pid) {
      process.kill(container.pid, 'SIGTERM');
    }
    cb();
  };



  var readPidDetails = function readPidDetails(cb) {
    pidHandler.readPidDetails(cb);
  };



  return {
    start: start,
    stop: stop,
    readPidDetails: readPidDetails
  };
};

