// this file should be run with electron binary
// ex. node_modules/.bin/electron electron-main.js

const electron = require( 'electron' )

const fs = require( 'fs' )
const path = require( 'path' )

// Module to control application life
const app = electron.app

// hide dock icon by default
app.dock && app.dock.hide && app.dock.hide()

// Module to create native browser window
const BrowserWindow = electron.BrowserWindow

const _pages = {}

const eleko = require( './index.js' )
const eeto = require( 'eeto' )

const stdioipc = require( './stdio-ipc.js' )

// is this needed?
let _launchOptions = {}

// create a named function out of a parse-function object
// ex. const pf = require('parse-function')().parse( function foo () {} )
//     const fn = createNamedFunction( pf )
function createNamedFunction ( pf ) {
  log( 1, 'createNamedFunction' )

  const fn = Function.apply(
    this,
    [
      `
      return function ${ pf.name || '' } ( ${ pf.args.join( ',' ) } ) {
        ${ pf.body }
      }
      `.trim()
    ]
  )
  return fn()
}

process.on( 'uncaughtException', function ( error ) {
  console.log( ' === uncaughtException === ' )
  console.log( error )

  try {
    console.log( 'exit electron: uncaughtException' )
    app.quit()
  } catch ( err ) {
    /* ignore */
  }

  process.exit( 1 )
} )

const _envs = {}
Object.keys( process.env ).forEach(
  function ( key ) {
    const n = process.env[ key ]
    if ( n == '0' || n == 'false' || !n ) {
      return _envs[ key ] = false
    }
    _envs[ key ] = n
  }
)

const verbosity = (
  _envs.debug ? 10 : _envs.verbose
)

function log ( level, message ) {
  if ( level > verbosity ) return
  console.log( message )
}

// example data
const _philipGlassHoursVideoId = 'Wkof3nPK--Y'
const pkmnBlueWaveId = 'pFbkURxNKPE' // requires h264
const creedenceId = 'Gu2pVPWGYMQ' // AV1
const _urlTemplate = 'https://www.youtube.com/watch/$videoId'
const _videoId = creedenceId

// notify launch with eleko to setup stdio ipc with env
// variable
let _appReady = false

const ipc = stdioipc.create( process.stdin, process.stdout )

let _lastHeartBeat = Date.now()
let _heartbeatTimeout
ipc.on( 'heartbeat', function () {
  const now = Date.now()
  _lastHeartBeat = now
} )

checkHeartbeat() // start checking heartbeats
function checkHeartbeat () {
  const now = Date.now()
  const delta = now - _lastHeartBeat

  if ( delta > 3000 ) {
    console.log( 'exit electron: heartbeat stopped' )
     setTimeout( function () {
      app.quit()
    }, 0 )
    return false
  }

  clearTimeout( _heartbeatTimeout )
  _heartbeatTimeout = setTimeout( checkHeartbeat, 500 )
  return true
}

ipc.on( 'promise', function ( p ) {
  const data = p.data
  log( 1, 'promise: ' + data.type )

  function callback ( err, value ) {
    if ( callback.done ) return
    callback.done = true
    log( 1, 'promise:callback' )
    if ( err ) return p.reject( err )
    p.resolve( value )
  }

  const req = {
    callback: callback,
    data: data.content
  }

  ipc.emit( 'promise:' + data.type, req )
} )

ipc.on( 'close', function () {
  log( 1, 'exit: browser.close() called' )
  setTimeout( function () {
    app.quit()
  }, 0 )
} )

ipc.on( 'promise:newPage', async function ( req ) {
  log( 1, 'promise:newPage' )

  const options = req.data
  const page = await createPage( options )

  req.callback( undefined, page.id )
  log( 1, 'new page created' )
} )

ipc.on( 'promise:page:goto', async function ( req ) {
  log( 1, 'promise:page:goto' )

  log( 1, req.data )

  const page = _pages[ req.data.id ]
  const url = req.data.url

  log( 1, 'page:' )
  log( 1, page )

  try {
    log( 1, 'promise:page:goto:waiting' )
    await eleko.goto( page.win, url )
    log( 1, 'promise:page:goto:done' )
    req.callback( undefined )
  } catch ( err ) {
    log( 1, 'promise:page:goto:error' )
    console.log( err )
    req.callback( err && err.message || err )
  }
} )

ipc.on( 'promise:page:close', async function ( req ) {
  log( 1, 'promise:page:close' )

  log( 1, req.data )
  const page = _pages[ req.data.id ]

  try {
    log( 1, 'promise:page:close:waiting' )
    await page.win.destroy()
    log( 1, 'promise:page:close:done' )
    req.callback( undefined )
  } catch ( err ) {
    log( 1, 'promise:page:close:error' )
    console.log( err )
    req.callback( err && err.message || err )
  }
} )

ipc.on( 'promise:page:evaluate', async function ( req ) {
  log( 1, 'promise:page:evaluate' )

  log( 1, req.data )

  const page = _pages[ req.data.id ]
  const data = req.data

  log( 1, 'page:' )
  log( 1, page )

  if ( !page ) {
    return req.callback( 'no page found for id: ' + req.data.id )
  }

  const pf = data.pf
  const args = data.args

  log( 1, 'page:evaluate createNamedFunction' )

  const evalFn = createNamedFunction( pf )
  log( 1, 'page:evaluate createNamedFunction:done' )
  log( 1, evalFn.toString() )

  const evalArgs = args

  const applyArgs = [
    page.win,
    evalFn,
    args
  ]

  try {
    log( 1, 'promise:page:evaluate:waiting' )
    const value = await eleko.evaluate.apply( this, applyArgs )
    log( 1, 'promise:page:evaluate:done' )
    req.callback( undefined, value )
  } catch ( err ) {
    log( 1, 'promise:page:evaluate:error' )
    console.log( err )
    req.callback( err && err.message || err )
  }
} )

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs
app.on( 'ready', async function () {
  ipc.emit( 'ready' )
} )

// Quit when all windows are closed.
app.on( 'window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  // if ( process.platform !== 'darwin' ) {
  //    app.quit()
  // }

  console.log( 'exit electron: window-all-closed' )
  setTimeout( function () {
    app.quit()
  }, 0 )
})

app.on( 'activate', function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  // if ( mainWindow === null ) {
  //   createWindow()
  // }
})

async function createPage ( options )
{
  log( 1, ' === createPage === ' )

  return new Promise( async function ( resolve, reject ) {
    options = options || {}

    options = Object.assign(
      {},
      {
        show: !!( _envs.show || _envs.debug ),
        width: 800,
        height: 600,
        webPreferences: {}
      },
      options
    )

    // setup options.webPreferences
    // ( Object.assign isn't recursive )
    options.webPreferences = Object.assign(
      {},
      {
        autoplayPolicy: [ 'no-user-gesture-required', 'user-gesture-required', 'document-user-activation-required' ][ 2 ],

        // javascript: false,
        images: false,
        webgl: false,

        // security stuff
        nodeIntegration: false,
        webviewTag: false,
        contextIsolation: true,
        enableRemoteModule: false,

        // preload: path.join( __dirname, 'electron-preload.js' )
      },
      options.webPreferences
    )

    if ( options.show ) {
      // show dock icon if showing window
      app.dock && app.dock.show && app.dock.show()
    }

    log( 1, 'normalized options' )

    // Create the browser window
    log( 1, 'creating new BrowserWindow...' )
    const mainWindow = new BrowserWindow( options )
    log( 1, 'new BrowserWindow' )

    const session = mainWindow.webContents.session

    // set user-agent lowest compatible by default
    session.setUserAgent( 'Mozilla/5.0 (https://github.com/talmobi/eleko)' )

    // const cookies = electron.session.defaultSession.cookies
    const cookies = session.cookies

    // https://electronjs.org/docs/api/cookies
    // Query all cookies.
    cookies.get( {}, function ( error, cookies ) {
      // console.log( error, cookies )
    } )

    // Query all cookies associated with a specific url
    cookies.get( { url: 'http://youtube.com' }, function ( error, cookies ) {
      // console.log( error, cookies )
    } )

    // Set a cookie with the given cookie data;
    // may overwrite equivalent cookies if they exist.
    const cookie = { url: 'https://www.youtube.com', name: 'CONSENT', value: 'YES+', domain: '.youtube.com' }
    cookies.set( cookie, function ( error ) {
      if ( error ) console.error( error )
    } )

    mainWindow.on( 'ready-to-show', function () {
      log( 1, 'ready-to-show' )
      // mainWindow.show()
    } )

    // and load the index.html of the app
    // mainWindow.loadFile(
    // path.join( __dirname, 'index.html' )
    // )

    // Open the DevTools in debug mode by default
    if ( _envs.debug || _envs.devtools ) {
      mainWindow.webContents.openDevTools()
    }

    // load url
    log( 1, 'opening about:blank...' )
    // TODO turn once dom-ready into promise
    let _resolveDomReady
    const _promiseDomReady = new Promise( function ( resolve ) {
      _resolveDomReady = resolve
    })
    mainWindow.webContents.once( 'dom-ready', function () {
      log( 1, 'dom-ready' )
      _resolveDomReady()
    } )
    log( 1, 'about:blank' )
    mainWindow.webContents.loadURL( 'about:blank' )
    await _promiseDomReady

    log( 1, 'awaiting document.location...' )
    await eleko.waitFor( mainWindow, function () {
      return !!document.location
    } )
    log( 1, 'document.location' )

    const page = { win: mainWindow }
    _pages._ids = ( _pages._ids || 1 )
    page.id = _pages._ids++
    _pages[ page.id ] = page

    // Emitted when the window is closed
    mainWindow.on( 'closed', function () {
      log( 1, 'window closed (page.id: ' + page.id + ')' )

      // Dereference the window object, usually you would store windows
      // in an array if your app supports multi windows, this is the time
      // when you should delete the corresponding element
      delete page.win
    } )

    // attach request handler
    session.webRequest.onBeforeRequest(
      async function ( details, callback ) {
        let url = details.url

        // special cases to always allow
        if ( url.indexOf( 'devtools' ) === 0 ) {
          return callback( { cancel: false } )
        }
        if ( url.indexOf( 'about:blank' ) === 0 ) {
          return callback( { cancel: false } )
        }
        if (
          url.indexOf( 'http' ) !== 0 &&
          url.indexOf( 'file' ) !== 0
        ) {
          return callback( { cancel: false } )
        }

        log( 2, ' == onBeforeRequest: ' + url.slice( 0, 23 ) )

        const shouldBlock = await ipc.promise( {
          type: 'page:onrequest',
          pageId: page.id,
          details: details
        } )

        log( 2, 'shouldBlock: ' + shouldBlock )

        if ( shouldBlock ) {
          log( 2, ' (x) url blocked: ' + url.slice( 0, 55 ) )
          callback( { cancel: true } ) // block
        } else {
          callback( { cancel: false } ) // let through
        }
      }
    )

    resolve( page )
  } )
}
