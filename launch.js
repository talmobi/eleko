const electron = require( 'electron' )

const fs = require( 'fs' )
const path = require( 'path' )

const jp = require( 'jsonpath' )

const eleko = require( './index.js' )
const functionToString = require( 'function-to-string' )
const { serializeError, deserializeError } = require( 'serialize-error' )

// Module to control application life
const app = electron.app

// hide dock icon
app.dock && app.dock.hide && app.dock.hide()

// Module to create native browser window
const BrowserWindow = electron.BrowserWindow

const _consoleLog = console.log
console.log = function ( ...args ) {
  emit( {
    type: 'console.log',
    args: args
  } )
}

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
  if ( !_envs.debug_eleko ) return
  emit( {
    type: 'console.log',
    args: args
  } )
}

debugLog( ' == launched == ' )

process.on( 'uncaughtException', function ( err ) {
  try {
    console.log( err )
    console.log( 'exited electron app' )
    emit( {
      type: 'error',
      error: serializeError( err )
    } )
    setTimeout( function () {
      app.quit()
    }, 500 )
  } catch ( err ) {
    /* ignore */
  }

  process.exit( 1 )
} )

// Keep a global ref of the window object, if you don't, the window
// will be closed automatically when the JavaScript object
// is garbage collected
let mainWindow

let _buffer = ''
process.stdin.on( 'data', function ( chunk ) {
  _buffer += chunk

  if ( init.ready ) {
    _processBuffer()
  }
} )

function _processBuffer ()
{
  debugLog( ' == _processBuffer == ' )

  const lines = _buffer.split( '\n' )
  _buffer = lines.pop()

  for ( let i = 0; i < lines.length; i++ ) {
    const line = lines[ i ]
    handleLine( line )
  }
}

function emit ( json )
{
  if ( typeof json !== 'object') throw new TypeError( 'json must be of type object' )
  const jsonString = JSON.stringify( json )
  process.stdout.write( jsonString + '\n' )
}

async function handleLine ( line )
{
  debugLog( ' == handleLine == ' )

  let json
  try {
    json = JSON.parse( line )
  } catch ( err ) {
    debugLog( err )
  }

  try {
    const type = json.type
    const query = json.query
    const args = json.args || []

    // debugLog( 'id: ' + json.id )
    // debugLog( 'type: ' + type )
    // debugLog( 'query: ' + query )

    switch ( type ) {
      case 'eleko:ipc:init':
        {
          createWindow( json.options )
        }
        break

      case 'eleko:ipc:globalEvaluate':
        {
          const fn = decodeValue2( json.fn )
          const fnArgs = args.map( decodeValue2 )
          let value = fn.apply( this, fnArgs )

          function finish () {
            debugLog( ' == finish == ' )

            emit( {
              type: 'resolve',
              id: json.id,
              value: value
            } )
          }

          handlePromise()
          async function handlePromise () {
            if ( value && typeof value === 'object' && typeof value.then === 'function' ) {
              // is a promise
              const promise = value

              promise.then( function ( val ) {
                value = val
                return handlePromise()
              } )

              promise.catch( function ( err ) {
                debugLog( 'error: ' + err )
                debugLog( err )
                return emit( {
                  type: 'resolve',
                  id: json.id,
                  error: serializeError( err )
                } )
              } )
            } else {
              finish()
            }
          }
        }
        break

      case 'eleko:ipc:call':
        {
          const fn = jp.value( mainWindow, query )

          let that = mainWindow
          try {
            that = jp.value( mainWindow, query.split( '.' ).slice( 0, -1 ).join( '.' ) )
          } catch ( err ) {
            /* ignore */
          }

          debugLog( query )
          debugLog( fn )

          args && debugLog( ' == args == ' + args.length )
          args && debugLog( args )

          const txArgs = args.map( function ( arg ) {
            return decodeValue( arg )
          } )

          txArgs && debugLog( ' == txArgs == ' + txArgs.length )
          txArgs && debugLog( txArgs )

          let value = fn.apply(
            that,
            txArgs
          )

          console.log( value )

          function finish () {
            debugLog( ' == finish == ' )

            emit( {
              type: 'resolve',
              id: json.id,
              value: value
            } )
          }

          handlePromise()
          async function handlePromise () {
            if ( value && typeof value === 'object' && typeof value.then === 'function' ) {
              // is a promise
              const promise = value

              promise.then( function ( val ) {
                value = val
                return handlePromise()
              } )

              promise.catch( function ( err ) {
                console.log( 'error: ' + err )
                console.log( err )

                return emit( {
                  type: 'resolve',
                  id: json.id,
                  error: serializeError( err )
                } )
              } )
            } else {
              finish()
            }
          }
        }
        break

      case 'eleko:ipc:app':
        {
          const fn = jp.value( electron.app, query )

          let that = electron.app

          debugLog( query )
          debugLog( fn )

          args && debugLog( ' == args == ' + args.length )
          args && debugLog( args )

          const txArgs = args.map( function ( arg ) {
            return decodeValue( arg )
          } )

          txArgs && debugLog( ' == txArgs == ' + txArgs.length )
          txArgs && debugLog( txArgs )

          let value = fn.apply(
            that,
            txArgs
          )

          function finish () {
            debugLog( ' == finish == ' )

            emit( {
              type: 'resolve',
              id: json.id,
              value: value
            } )
          }

          handlePromise()
          async function handlePromise () {
            if ( value && typeof value === 'object' && typeof value.then === 'function' ) {
              // is a promise
              const promise = value

              promise.then( function ( val ) {
                value = val
                return handlePromise()
              } )

              promise.catch( function ( err ) {
                debugLog( 'error: ' + err )
                debugLog( err )
                return emit( {
                  type: 'resolve',
                  id: json.id,
                  error: serializeError( err )
                } )
              } )
            } else {
              finish()
            }
          }
        }
        break

      case 'eleko:ipc:eleko':
        {
          const fn = eleko[ query ]
          let that = eleko

          debugLog( query )
          debugLog( fn )

          args && debugLog( ' == args == ' + args.length )
          args && debugLog( args )

          const txArgs = args.map( function ( arg ) {
            return decodeValue( arg )
          } )

          txArgs && debugLog( ' == txArgs == ' + txArgs.length )
          txArgs && debugLog( txArgs )

          let value = fn.apply(
            that,
            [ mainWindow ].concat( txArgs )
          )

          function finish () {
            debugLog( ' == finish == ' )

            emit( {
              type: 'resolve',
              id: json.id,
              value: value
            } )
          }

          handlePromise()
          async function handlePromise () {
            if ( value && typeof value === 'object' && typeof value.then === 'function' ) {
              // is a promise
              const promise = value

              promise.then( function ( val ) {
                value = val
                return handlePromise()
              } )

              promise.catch( function ( err ) {
                debugLog( 'error: ' + err )
                debugLog( err )
                return emit( {
                  type: 'resolve',
                  id: json.id,
                  error: serializeError( err )
                } )
              } )
            } else {
              finish()
            }
          }
        }
        break

      default:
        debugLog( 'unknown type: ' + type )
    }
  } catch ( err ) {
    emit( {
      type: 'resolve',
      id: json.id,
      error: serializeError( err )
    } )
  }
}

async function createWindow ( options )
{
  if ( createWindow.done ) return
  createWindow.done = true

  const opts = Object.assign( {
    show: !_envs.debug_eleko || !_envs.debug,
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
      preload: path.join( __dirname, 'preload.js' )
    }
  }, options )

  // if ( opts.show ) {
  if ( opts.show ) {
    // show dock icon
    app.dock && app.dock.show && app.dock.show()
  }

  // Create the browser window
  mainWindow = new BrowserWindow( opts )

  await mainWindow.loadURL( 'about:blank' )

  await eleko.waitFor( mainWindow, function () {
    return !!document.location
  } )

  debugLog( ' == window created == ' )

  const session = mainWindow.webContents.session

  // set user-agent lowest compatible
  session.setUserAgent( 'Mozilla/5.0 (https://github.com/talmobi/eleko)' )

  // process anything in the buffer now that we're ready
  if ( _buffer ) _processBuffer()
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs
app.on( 'ready', async function () {
  init.ready = true

  // process anything in the buffer now that we're ready
  if ( _buffer ) _processBuffer()

  init()
} )

function init () {
  if ( init.done ) return
  if ( init.ready && init.options ) {
    init.done = true
    createWindow()
  }
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

function decodeValue ( pkg )
{
  const type = pkg.type
  const content = pkg.content

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

function decodeValue2 ( pkg )
{
  const type = pkg.type
  const content = pkg.content

  if ( type === 'object' || type === 'boolean' ) {
    return JSON.parse( content )
  } else if ( type === 'string' ) {
    return content
  } else if ( type === 'number' ) {
    return Number( content )
  } else if ( type === 'function' ) {
    const info = JSON.parse( content )

    // const f = eval(`
    //   ;(function () {
    //     return function ${ info.name || '' } ( ${ info.params.join( ', ' ) } ) {
    //       ${ info.body }
    //     }
    //   })()
    // `)

    const f = Function.apply( {}, info.params.concat( [ info.body ] ) )

    return f
  }
}
