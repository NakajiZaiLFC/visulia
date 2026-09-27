<%@ page contentType="application/json; charset=UTF-8" trimDirectiveWhitespaces="true" %><%
String action = request.getPathInfo();
if ("/health".equals(action)) {
    request.setAttribute("visulia.skiplog", Boolean.TRUE);
    out.print("{\"status\":\"ready\"}");
} else if ("/ok".equals(action)) {
    out.print("{\"scenario\":\"normal\"}");
} else if ("/slow".equals(action)) {
    Thread.sleep(250);
    out.print("{\"scenario\":\"slow\"}");
} else if ("/error".equals(action)) {
    response.setStatus(500);
    out.print("{\"scenario\":\"intentional-error\"}");
} else {
    response.setStatus(404);
    out.print("{\"scenario\":\"not-found\"}");
}
%>
