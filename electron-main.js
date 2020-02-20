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

const eleko = require( './index.js' )
const jp = require( 'jsonpath' )

process.on( 'uncaughtException', function ( error ) {
  console.log( ' === uncaughtException === ' )
  console.log( error )

  try {
    console.log( 'exiting electron app' )
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

function debugLog ( ...args ) {
  if ( !_envs.debug ) return
  console.log.apply( this, args )
}

// Keep a global ref of the window objects, if you don't, the widow
// will be closed automatically when the JavaScript object
// is garbage collected
let _pageIndexes = 0
const _pages = []

// example data
const _philipGlassHoursVideoId = 'Wkof3nPK--Y'
const pkmnBlueWaveId = 'pFbkURxNKPE' // requires h264
const creedenceId = 'Gu2pVPWGYMQ' // AV1
const _urlTemplate = 'https://www.youtube.com/watch/$videoId'
const _videoId = creedenceId

// notify launch with eleko to setup stdio ipc with env
// variable
let _appReady = false

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs
app.on( 'ready', async function () {
  _appReady = true

  // if launched with eleko.launch we create window only
  // after options have been sent
  if ( _envs.launched_with_eleko ) {
    debugLog( 'app-ready' )

    emit( {
      type: 'app-ready'
    } )

    if ( _stdin_buffer ) {
      setTimeout( function () {
        _processBuffer()
      }, 1 )
    }
  } else {
    createWindow()
  }
} )

let _messageId = 1
const _promiseMap = {}

let _stdin_buffer = ''
if ( _envs.launched_with_eleko ) {
  // setup ipc through stdio
  process.stdin.on( 'data', function ( chunk ) {
    _stdin_buffer += chunk

    if ( _appReady ) {
      _processBuffer()
    }
  } )
}

// Quit when all windows are closed.
app.on( 'window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  // if ( process.platform !== 'darwin' ) {
  //    app.quit()
  // }

  app.quit()
})

app.on( 'activate', function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  // if ( mainWindow === null ) {
  //   createWindow()
  // }
})

async function createWindow ( options )
{
  debugLog( ' === createWindow === ' )

  return new Promise( async function ( resolve, reject ) {
    options = options || {}

    options = Object.assign( {}, {
      show: _envs.debug ? true : false,
      width: 800,
      height: 600,
      webPreferences: {
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
      }
    }, options )

    if ( options.show ) {
      // show dock icon if showing window
      app.dock && app.dock.show && app.dock.show()
    }

    debugLog( 'normalized options' )

    // Create the browser window
    debugLog( 'creating new BrowserWindow...' )
    const mainWindow = new BrowserWindow( options )
    debugLog( 'new BrowserWindow' )
    mainWindow._eleko_data = {}
    mainWindow._eleko_data.pageIndex = _pageIndexes++

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
      debugLog( 'ready-to-show' )
      // mainWindow.show()
    } )

    // and load the index.html of the app
    // mainWindow.loadFile(
    // path.join( __dirname, 'index.html' )
    // )

    // Open the DevTools in debug mode by default
    if ( _envs.debug ) {
      mainWindow.webContents.openDevTools()
    }

    // load url
    debugLog( 'opening about:blank...' )
    await mainWindow.loadURL( 'about:blank' )
    debugLog( 'about:blank' )

    debugLog( 'awaiting document.location...' )
    await eleko.waitFor( mainWindow, function () {
      return !!document.location
    } )
    debugLog( 'document.location' )

    // Emitted when the window is closed
    mainWindow.on( 'closed', function () {
      debugLog( 'window closed' )

      // Dereference the window object, usually you would store windows
      // in an array if your app supports multi windows, this is the time
      // when you should delete the corresponding element

      // remove this page from global reference list
      let i = _pages.indexOf( mainWindow )
      _pages.splice( i, 1 )

      emit( {
        type: 'page:close',
        pageIndex: mainWindow._eleko_data.pageIndex
      } )
    } )

    _pages.push( mainWindow )
    resolve( mainWindow )

    // attach request handler
    session.webRequest.onBeforeRequest(
      async function ( details, callback ) {
        let url = details.url

        if ( url.indexOf( 'devtools' )  === 0 ) {
          return callback( { cancel: false } )
        }

        debugLog( ' == onBeforeRequest: ' + url.slice( 0, 23 ) )

        let _resolve, _reject
        const _promise = new Promise( function ( resolve, reject ) {
          _resolve = resolve
          _reject = reject
        } )

        const messageId = _messageId++
        _promiseMap[ messageId ] = {
          promise: _promise,
          resolve: _resolve,
          reject: _reject
        }

        emit( {
          type: 'page:request',
          pageIndex: mainWindow._eleko_data.pageIndex,
          messageId: messageId,
          details: details
        } )

        const shouldBlock = await _promise

        if ( shouldBlock ) {
          debugLog( ' (x) url blocked: ' + url.slice( 0, 55 ) )
          callback( { cancel: true } ) // block
        } else {
          callback( { cancel: false } ) // let through
        }
      }
    )
  } )
}


function parseArg ( arg )
{
  const type = arg.type
  const content = arg.content

  if ( type === 'object' || type === 'boolean' ) {
    return JSON.parse( content )
  } else if ( type === 'string' ) {
    return content
  } else if ( type === 'number' ) {
    return Number( content )
  } else if ( type === 'function' ) {
    const info = JSON.parse( content )
    const f = eval(`
      ;(function () {
        return function ${ info.name || '' } ( ${ info.params.join( ', ' ) } ) {
          ${ info.body }
        }
      })()
    `)

    debugLog( ' == funcions == ' )
    debugLog( f.toString() )

    return f
  }
}

function _processBuffer ()
{
  debugLog( ' == _processBuffer == ' )

  const lines = _stdin_buffer.split( '\n' )
  _stdin_buffer = lines.pop()

  for ( let i = 0; i < lines.length; i++ ) {
    const line = lines[ i ]
    _processLine( line )
  }
}

async function _processLine ( line )
{
  debugLog( ' == _processLine == ' )

  let json
  try {
    json = JSON.parse( line )
  } catch ( err ) {
    throw err
  }

  try {
    const type = json.type
    const query = json.query
    const args = json.args || []

    // debugLog( 'messageId: ' + json.messageId )
    // debugLog( 'type: ' + type )
    // debugLog( 'query: ' + query )

    switch ( type ) {
      // generic resolve
      case 'resolve':
        {
          const messageId = json.messageId
          const value = json.value

          const p = _promiseMap[ messageId ]
          p.resolve( value )
        }
        break

      case 'browser:pages':
        {
          const pages = _pages.map( function ( page ) {
            return page._eleko_data
          } )

          return emit( {
            type: 'browser:pages:response',
            messageId: json.messageId,
            pages: pages
          } )
        }
        break

      case 'browser:newPage':
        {
          const newPage = await createWindow( json.options )

          return emit( {
            type: 'browser:newPage:response',
            messageId: json.messageId,
            newPage: newPage._eleko_data
          } )
        }
        break

      // executing functions on electron.app
      // ex: app.quit()
      case 'app':
        {
          const fn = jp.value( electron.app, query )

          let that = electron.app

          debugLog( query )
          debugLog( fn )

          args && debugLog( ' == args == ' + args.length )
          args && debugLog( args )

          const parsedArgs = args.map( function ( arg ) {
            return parseArg( arg )
          } )

          parsedArgs && debugLog( ' == parsedArgs == ' + parsedArgs.length )
          parsedArgs && debugLog( parsedArgs )

          let value = fn.apply(
            that,
            parsedArgs
          )

          function finish () {
            debugLog( ' == finish == ' )

            emit( {
              type: 'resolve',
              messageId: json.messageId,
              value: value
            } )
          }

          debugLog( 'value: ' + value )

          _resolve()
          async function _resolve () {
            if ( value && typeof value === 'object' && typeof value.then === 'function' ) {
              // is a promise
              const promise = value

              promise.then( function ( newValue ) {
                debugLog( 'promise:then' )
                value = newValue
                return _resolve()
              } )

              promise.catch( function ( err ) {
                debugLog( 'promise:catch' )

                console.log( 'error: ' + err )
                console.log( err )

                return emit( {
                  type: 'resolve',
                  messageId: json.messageId,
                  error: serializeError( err )
                } )
              } )
            } else {
              finish()
            }
          }
        }
        break

      // use jsonpath to call methods on the page object
      case 'page:query':
        {
          const pageIndex = json.pageIndex
          const page = _pages.find( function ( page ) { return page._eleko_data.pageIndex === json.pageIndex } )

          // fatal error
          if ( !page ) throw new Error( 'no such pageIndex found: ' + json.pageIndex )

          debugLog( 'page found' )

          // get the method using a jsonpath query
          const fn = jp.value( page, json.query )

          // set the parent/context of the method ( when used with .call/.apply )
          let that = jp.parent( page, json.query ) || page

          debugLog( query )
          debugLog( fn )

          args && debugLog( ' == args == ' + args.length )
          args && debugLog( args )

          const parsedArgs = args.map( function ( arg ) {
            return parseArg( arg )
          } )

          parsedArgs && debugLog( ' == parsedArgs == ' + parsedArgs.length )
          parsedArgs && debugLog( parsedArgs )

          let value = fn.apply(
            that,
            parsedArgs
          )

          _resolve()
          async function _resolve () {
            // await promise values before resolving through ipc
            if ( value && typeof value === 'object' && typeof value.then === 'function' ) {
              // is a promise
              const promise = value

              promise.then( function ( newValue ) {
                value = newValue
                return _resolve()
              } )

              promise.catch( function ( err ) {
                console.log( 'error: ' + err )
                console.log( err )

                // show app on error
                app.dock && app.dock.show && app.dock.show()
                page && page.show && page.show()
                page && page.webContents && page.webContents.openDevTools()

                return emit( {
                  type: 'resolve',
                  messageId: json.messageId,
                  error: serializeError( err )
                } )
              } )
            } else {
              finish()
            }
          }

          function finish () {
            debugLog( ' == finish == ' )

            emit( {
              type: 'resolve',
              messageId: json.messageId,
              value: value
            } )
          }
        }
        break

      // special case for executing eleko helper fn's
      case 'page:eleko':
        {
          debugLog( ' === page:eleko === ' )

          const pageIndex = json.pageIndex
          const page = _pages.find( function ( page ) { return page._eleko_data.pageIndex === json.pageIndex } )

          // fatal error
          if ( !page ) throw new Error( 'no such pageIndex found: ' + json.pageIndex )

          debugLog( 'page found' )

          const query = json.query
          const args = json.args

          debugLog( 'query: ' + query )
          debugLog( 'args: ' + args )

          const fn = eleko[ query ]
          let that = eleko

          debugLog( query )
          debugLog( fn )

          args && debugLog( ' == args == ' + args.length )
          args && debugLog( args )

          const parsedArgs = args.map( function ( arg ) {
            return parseArg( arg )
          } )

          parsedArgs && debugLog( ' == parsedArgs == ' + parsedArgs.length )
          parsedArgs && debugLog( parsedArgs )

          let value = fn.apply(
            that,
            [ page ].concat( parsedArgs )
          )

          _resolve()
          async function _resolve () {
            // await promise values before resolving through ipc
            if ( value && typeof value === 'object' && typeof value.then === 'function' ) {
              // is a promise
              const promise = value

              promise.then( function ( newValue ) {
                value = newValue
                return _resolve()
              } )

              promise.catch( function ( err ) {
                console.log( 'error: ' + err )
                console.log( err )

                // show app on error
                app.dock && app.dock.show && app.dock.show()
                page && page.show && page.show()
                page && page.webContents && page.webContents.openDevTools()

                return emit( {
                  type: 'resolve',
                  messageId: json.messageId,
                  error: serializeError( err )
                } )
              } )
            } else {
              finish()
            }
          }

          function finish () {
            debugLog( ' == finish == ' )

            emit( {
              type: 'resolve',
              messageId: json.messageId,
              value: value
            } )
          }
        }
        break

      default:
        debugLog( 'electron unknown type: ' + type )
    }
  } catch ( err ) {
    console.log( err )
    emit( {
      type: 'error',
      error: serializeError( err )
    } )
  }
}

function emit ( json )
{
  if ( typeof json !== 'object') throw new TypeError( 'json must be of type object' )

  debugLog( 'emit type: ' + json.type )

  const jsonString = JSON.stringify( json )
  process.stdout.write( jsonString + '\n' )
}

function findFirstMethod ( obj ) {
  const keys = Object.keys( obj )
}
