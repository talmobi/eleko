const fs = require( 'fs' )
const path = require( 'path' )
const url = require( 'url' )

const eeto = require( 'eeto' )

const api = eeto()

module.exports = api
api.spawn = spawn
api.launch = launch
api.goto = goto
api.waitFor = waitFor
api.evaluate = evaluate
api.onBeforeRequest = onBeforeRequest
api.getDefaultOptions = getDefaultOptions
api.containsAds = containsAds

api.infect = function ( mainWindow ) {
  const infectedApi = {}

  ;[
    'goto',
    'waitFor',
    'evaluate',
    'onBeforeRequest'
  ].forEach( function ( name ) {
    infectedApi[ name ] = function ( ...args ) {
      args = [ mainWindow ].concat( args )
      api[ name ].apply( this, args )
    }
  } )

  return infectedApi
}

const WAITFOR_TIMEOUT_TIME = 1000 * 30 // 30 seconds
const POLL_INTERVAL = 200 // milliseconds
const LAUNCH_TIMEOUT_TIME = 10 * 1000

// TODO add software rendering opts
// ref: https://swiftshader.googlesource.com/SwiftShader
// ref: https://github.com/google/swiftshader
const DEFAULT_OPTS = {
  show: false,
  width: 800,
  height: 600,
  webPreferences: {
    autoplayPolicy: [ 'no-user-gesture-required', 'user-gesture-required', 'document-user-activation-required' ][ 2 ],

    // javascript: false,
    images: false,
    webgl: false,

    nodeIntegration: false,
    webviewTag: false,
    contextIsolation: true,
    enableRemoteModule: false,

    // preload: path.join( __dirname, 'preload.js' )
    preload: undefined
  }
}

function getDefaultOptions ()
{
  return Object.assign( {}, DEFAULT_OPTS )
}

function spawn ( filepath )
{
  // path to electron executable in node context
  const _electron = require( 'electron' )

  if ( typeof _electron !== 'string' ) {
    console.log( 'not a string' )
    throw new Error(`
      Error: trying to spawn electron inside of an existing electron context.
      Spawn from within a node context instead.
        ex. 'node index.js'
    `)
  }

  const _childProcess = require( 'child_process' )

  const _path = require( 'path' )
  const _nz = require( 'nozombie' )()

  function onExit () {
    _nz.kill()
  }

  process.on( 'exit', onExit )

  // file to be run with electron
  const mainPath = filepath

  try {
    fs.statSync( filepath )
  } catch ( err ) {
    throw err
  }

  const command = _electron + ' ' + mainPath
  console.log( 'command: ' + command )

  const spawn = _childProcess.spawn( _electron, [ mainPath ], { stdio: 'inherit', shell: false } )
  _nz.add( spawn.pid )

  spawn.on( 'exit', function () {
    process.removeListener( 'exit', onExit )
  } )

  return spawn
}

function launch ( electron, _options )
{
  if ( typeof electron === 'string' ) {
    throw new Error(`
      Error: trying to launch outide of electron context.
      You need to run with the electron binary instead of node.
        ex. 'electron main.js'
        ex. 'node_modules/.bin/electron main.js'
    `)
  }

  // Module to control application life
  const app = electron.app

  process.on( 'uncaughtException', function ( error ) {
    console.log( ' === uncaughtException === ' )

    try {
      app.quit()
      console.log( 'exited electron app' )
    } catch ( err ) {
      /* ignore */
    }

    console.log( error )

    process.exit( 1 )
  } )

  // Module to create native browser window
  const BrowserWindow = electron.BrowserWindow

  return new Promise( function ( resolve, reject ) {
    let _stage = 'pollReadyState'
    let _done = false
    const _timeout = setTimeout( function () {
      if ( _done ) return
      _done = true
      reject( 'error: timed out launch at ' + _stage + ' stage' )
    }, LAUNCH_TIMEOUT_TIME )

    // can't reall attach app.on( 'ready' ) listener because it
    // might already have been called
    pollReadyState()

    function pollReadyState () {
      if ( _done ) return
      console.log( 'pollReadyState' )

      if ( app.isReady() ) {
        onReady()
      } else {
        setTimeout( pollReadyState, 33 )
      }
    }

    function onReady () {
      console.log( 'onReady' )

      _stage = 'onReady new BrowserWindow'
      // Create the browser window
      const opts = Object.assign( getDefaultOptions(), _options || {} )
      let mainWindow = new BrowserWindow( opts )

      const session = mainWindow.webContents.session

      // set user-agent lowest compatible
      session.setUserAgent( 'Mozilla/5.0 (https://github.com/talmobi/elekid)' )

      _stage = 'finish'
      finish()
      function finish () {
        console.log( 'finish' )
        if ( _done ) {
          // we already timed out and yet now the window is ready,
          // should rarely happen
          console.log( 'warning: launch finished but was timed out earlier (launch timeout too short?)' )
          mainWindow = undefined
          return
        }
        _done = true

        clearTimeout( _timeout )
        resolve( mainWindow )
      }
    }
  } )
}

function setUserAgent ( mainWindow )
{
  const session = mainWindow.webContents.session

  // set user-agent lowest compatible
  session.setUserAgent( 'Mozilla/5.0 (https://github.com/talmobi/elekid)' )
}

// mainWindow[, options], query[, ...args])
function waitFor ( mainWindow, query, ...args )
{
  let opts = {}
  if ( typeof query === 'object' ) {
    opts = query
    query = args[ 0 ]
    args = args.slice( 1 )
  }

  if ( typeof query === 'object' ) {
    throw new Error(
      'query must be a string, number or function\n' +
      'function waitFor( mainWindow[, options], query[, ...args] )'
    )
  }

  return new Promise ( function ( resolve, reject ) {
    if ( typeof query === 'number' ) {
      return setTimeout( resolve, query )
    }

    let fnString
    if ( typeof query === 'string' ) {
      fnString = (`
        ;(function () {
          console.log( ' === waitFor === ' )
          return !!document.querySelector( '${ query }' )
        })()
      `)
    } else {
      if ( typeof query !== 'function' ) {
        throw new Error(
          'query must be a string, number or function\n' +
          'function waitFor( mainWindow[, options], query[, ...args] )'
        )
      }
      fnString = parseFunction( query, args )
    }

    const startTime = Date.now()

    function callback ( result ) {
      console.log( ' === callback === ' )

      if ( result ) {
        return resolve()
      }

      const ms = Number( opts.polling ) || POLL_INTERVAL

      setTimeout( next, ms )
    }

    next()

    async function next () {
      console.log( ' === next === ' )

      const now = Date.now()
      const delta = ( now - startTime )
      if ( delta > WAITFOR_TIMEOUT_TIME ) {
        return reject( 'error: timed out waitFor' )
      }

      try {
        const p = await mainWindow.webContents.executeJavaScript(
          fnString,
          true
        )
        callback( p )
      } catch ( err ) {
        throw 'error: waitFor query: ' + query
      }
    }
  } )
}

function goto ( mainWindow, url )
{
  console.log( ' === goto === ' )

  return new Promise( async function ( resolve, reject ) {
    try {
      const p = await mainWindow.loadURL( url )
      console.log( ' >> GOTO DONE << ' )
      resolve()
    } catch ( err ) {
      reject( err )
    }
  } )
}

function evaluate ( mainWindow, fn, ...args )
{
  console.log( ' === evaluate === ' )

  const fnString = parseFunction( fn, args )

  return new Promise( async function ( resolve, reject ) {
    const p = await mainWindow.webContents.executeJavaScript(
      fnString,
      true
    )
    resolve( p )
  } )
}

function onBeforeRequest ( mainWindow, filter )
{
  const session = mainWindow.webContents.session

  // cancel or do something before requests
  session.webRequest.onBeforeRequest(
    function ( details, callback ) {
      const url = details.url
      const shouldBlock = filter( details )

      if ( shouldBlock ) {
        // block
        console.log( ' (x) url blocked: ' + url.slice( 0, 23 ) )
        return callback( { cancel: true } )
      }

      // don't block
      return callback( { cancel: false } )
    }
  )
}

// load adblock plus easylist to block urls related to ads
let easyList
try {
  easyList = fs.readFileSync(
    path.join( __dirname, './easylist.txt' ), 'utf8'
  ).split( /\r?\n\r?/ )
} catch ( err ) {
  console.log( 'failed to load easylist.txt ( try downloading with "npm run download-easylist" )' )
  easyList = []
}

// helper function for simple ad detection
function containsAds ( url )
{
  if ( !easyList ) return false

  url = String( url )

  for ( let i = 0; i < easyList.length; i++ ) {
    const item = easyList[ i ] || ''
    if ( item.length > 3 && url.indexOf( item ) >= 0 ) {
      return true
    }
  }

  return false
}

function parseFunction ( fn, args )
{
  const fnString = fn.toString()

  args = args.map( function ( arg ) { return JSON.stringify( arg ) } )

  const wrapped = (`
    ;(${ fnString })(${ args.join( ',' ) });
  `)

  console.log( ' === parseFunction begin === ' )
  console.log( wrapped )
  console.log( ' === parseFunction end === ' )

  return wrapped
}
