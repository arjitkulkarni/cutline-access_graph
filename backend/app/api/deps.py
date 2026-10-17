from fastapi import Request

from ..container import Container


def container(request: Request) -> Container:
    return request.app.state.container
