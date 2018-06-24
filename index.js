#!/usr/bin/env node

const _electron = require( 'electron' ) // path to electron executable in node context
const _childProcess = require( 'child_process' )

const _path = require( 'path' )

let mainPath = _path.join( __dirname, 'main.js' )

let args = 'elekid'

function exec ( args )
{
  console.log( 'starting electron' )
  _childProcess.exec( _electron + ' ' + mainPath + ' ' + args )
}
