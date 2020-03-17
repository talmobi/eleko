const net = require( 'net' )
const path = require( 'path' )
const rimraf = require( 'rimraf' )

const eeto = require( 'eeto' )

module.exports.create = create
module.exports.listen = listen

const _ipcPaths = []
const _timeouts = []
function clean () {
  for ( let i = 0; i < _timeouts.length; i++ ) {
    const t = _timeouts[ i ]
    clearTimeout( t )
  }

  for ( let i = 0; i < _ipcPaths.length; i++ ) {
    const p = _ipcPaths[ i ]
    rimraf.sync( p )
  }
}

process.on( 'exit', clean )

// ref: https://nodejs.org/api/net.html#net_identifying_paths_for_ipc_connections
function getIPCPath ( name ) {
  let ipcPath

  name = String( 'ipc[' + name + ']' )

  if ( process.platform === 'win32' ) {
    return path.join( '\\\\.\\pipe', __dirname, name + 'pipe' )
  }

  ipcPath = path.join( __dirname, name + '.pipe' )
  // delete in unix as it's not automatically cleaned up
  rimraf.sync( ipcPath )

  return ipcPath
}

function listen ( name, ms ) {
  return new Promise ( function ( resolve, reject ) {
    const ipcPath = getIPCPath( name )
    // console.log( 'listen:name:' + name )

    const api = eeto()

    let connectTimeout
    const errorTimeout = setTimeout( function () {
      clearTimeout( connectTimeout )
      reject( 'error: listen timed out (make sure to use create on your target process)' )
    }, ms || 1000 * 5 )
    _timeouts.push( errorTimeout )

    let connected = false

    connect()
    function connect () {
      if ( connected ) return

      clearTimeout( connectTimeout )
      connectTimeout = setTimeout( function () {
        const socket = net.connect( ipcPath )
        socket.once( 'connect', function () {
          connected = true
          clearTimeout( errorTimeout )
          // console.log( 'listen:connected' )
          api.socket = socket
          api.emit( 'connected' )
          resolve( api )
        } )

        socket.on( 'close', function ( hadError ) {
          if ( hadError && !connected ) {
            // try again to establish first connection
            connect()
          }
        } )
      }, 250 )

      _timeouts.push( connectTimeout )
    }

    api.buffer = ''

    api.ids = 1
    api.promises = []

    api._ready = false
    api._messages = []

    function attach () {
      api.socket.on( 'data', function api_onData ( chunk ) {
        onData( api, chunk )
      } )
    }

    api.parseMessage = function api_parseMessage ( jsonString ) {
      const json = JSON.parse( jsonString )
      api._messages.push( json )
      drain()
    }

    api.send = function api_send ( json ) {
      return send( api, json )
    }

    api.promise = function api_promise ( json ) {
      return promise( api, json )
    }

    api.once( 'ready', function () {
      api._ready = true
      drain()
    } )

    api.once( 'connected', function () {
      attach()
      drain()
    } )

    function drain () {
      if ( !api._ready ) return

      const messages = api._messages
      api._messages = []
      for ( let i = 0; i < messages.length; i++ ) {
        const evt = messages[ i ]

        switch ( evt.type ) {
          case 'promise':
            {
              function callback ( err, data ) {
                if ( callback.done ) return
                callback.done = true
                api.send( {
                  type: 'promise:response',
                  id: evt.id,
                  error: err,
                  content: data
                } )
              }

              const p = {
                resolve: function ( data ) {
                  callback( undefined, data )
                },
                reject: function ( err ) {
                  callback( err )
                },
                data: evt.content
              }

              api.emit( 'promise', p )
            }
            break

          case 'promise:response':
            {
              const p = api.promises[ evt.id ]
              delete api.promises[ evt.id ]
              if ( evt.error ) {
                p.reject( evt.error )
              } else {
                // console.log( evt )
                // console.log( 'promise content: ' + evt.content )
                p.resolve( evt.content )
              }
            }
            break

          default:
            api.emit( evt.type, evt.content )
        }
      }
    }

    return api
  } )
}

function create ( name ) {
  const ipcPath = getIPCPath( name )
  // console.log( 'create:name:' + name )

  const api = eeto()

  const server = net.createServer()
  api._server = server
  server.listen( ipcPath )
  server.once( 'connection', function ( socket ) {
    // console.log( 'create:connected' )
    api.socket = socket
    api.emit( 'connected' )
  } )
  _ipcPaths.push( ipcPath )

  api.buffer = ''

  api.ids = 1
  api.promises = []

  api._ready = false
  api._messages = []

  function attach () {
    api.socket.on( 'data', function api_onData ( chunk ) {
      onData( api, chunk )
    } )
  }

  api.parseMessage = function api_parseMessage ( jsonString ) {
    const json = JSON.parse( jsonString )
    api._messages.push( json )
    drain()
  }

  api.send = function api_send ( json ) {
    return send( api, json )
  }

  api.promise = function api_promise ( json ) {
    return promise( api, json )
  }

  api.once( 'ready', function () {
    api._ready = true
    drain()
  } )

  api.once( 'connected', function () {
    attach()
    drain()
  } )

  function drain () {
    if ( !api._ready ) return

    const messages = api._messages
    api._messages = []
    for ( let i = 0; i < messages.length; i++ ) {
      const evt = messages[ i ]

      switch ( evt.type ) {
        case 'promise':
          {
            function callback ( err, data ) {
              if ( callback.done ) return
              callback.done = true
              api.send( {
                type: 'promise:response',
                id: evt.id,
                error: err,
                content: data
              } )
            }

            const p = {
              resolve: function ( data ) {
                callback( undefined, data )
              },
              reject: function ( err ) {
                callback( err )
              },
              data: evt.content
            }

            api.emit( 'promise', p )
          }
          break

        case 'promise:response':
          {
            const p = api.promises[ evt.id ]
            delete api.promises[ evt.id ]
            if ( evt.error ) {
              p.reject( evt.error )
            } else {
              // console.log( evt )
              // console.log( 'promise content: ' + evt.content )
              p.resolve( evt.content )
            }
          }
          break

        default:
          api.emit( evt.type, evt.content )
      }
    }
  }

  return api
}

function onData ( api, chunk ) {
  api.buffer += chunk

  const lines = api.buffer.split( '\n' )
  api.buffer = lines.pop() // last line is not ready
  for ( let i = 0; i < lines.length; i++ ) {
    const line = lines[ i ]
    if ( line.indexOf( 'stdio-ipc: ' ) === 0 ) {
      api.parseMessage( line.slice( 'stdio-ipc: '.length ) )
    } else {
      api.emit( 'log', line )
    }
  }
}

function send ( api, json ) {
  const jsonString = JSON.stringify( json )
  api.socket.write( 'stdio-ipc: ' + jsonString  + '\n' )
}

function promise ( api, json ) {
  return new Promise( function ( resolve, reject ) {
    const evt = {
      type: 'promise',
      id: api.ids++,
      content: json
    }

    const p = {
      id: evt.id,
      time: Date.now(),
      resolve: resolve,
      reject: reject
    }
    api.promises[ p.id ] = p

    const jsonString = JSON.stringify( evt )
    api.socket.write( 'stdio-ipc: ' + jsonString  + '\n' )
  } )
}

function encodeArg ( arg )
{
  const type = typeof arg
  let content
  if ( type === 'object' || type === 'boolean' ) {
    content = JSON.stringify( arg )
  } else if ( type === 'string' ) {
    content = arg
  } else if ( type === 'number' ) {
    content = arg
  } else if ( type === 'function' ) {
    content = JSON.stringify(
      functionToString( arg )
    )
  }

  return {
    type: type,
    content: content
  }
}
